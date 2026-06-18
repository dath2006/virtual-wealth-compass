"""
Webcam Activity Tracker
========================
MediaPipe (continuous) + YOLOv8 (triggered snapshots)

States: FOCUSED | DROWSY | AWAY | ON_PHONE | DISTRACTED | READING_WRITING | LONG_AWAY

Install:
    pip install mediapipe opencv-python ultralytics numpy

Usage:
    python webcam_tracker.py
    python webcam_tracker.py --cam 0 --log session.jsonl --no-display
"""

import cv2
import time
import json
import math
import argparse
import threading
import collections
from datetime import datetime
from pathlib import Path

import numpy as np
import mediapipe as mp
from ultralytics import YOLO

# ──────────────────────────────────────────────
# CONFIG — tweak these without touching logic
# ──────────────────────────────────────────────
CFG = {
    # MediaPipe runs every frame; sample state every N seconds
    "state_sample_interval": 5,        # seconds between state snapshots

    # YOLOv8 triggered snapshot
    "yolo_periodic_interval": 30,      # seconds — periodic object check
    "yolo_trigger_cooldown": 8,        # seconds — don't re-trigger too fast

    # EAR thresholds (Eye Aspect Ratio)
    "ear_drowsy_threshold": 0.22,      # below this = eye closing
    "ear_drowsy_frames": 8,            # consecutive frames below threshold

    # Head pose thresholds (degrees)
    "yaw_distracted_deg": 28,          # looking left/right
    "pitch_down_deg": 20,              # looking down (phone/notebook)
    "distracted_sustain_sec": 8,       # how long before marking DISTRACTED

    # AWAY thresholds
    "away_short_sec": 10,              # AWAY (partial credit)
    "away_long_sec": 300,              # LONG_AWAY (session paused) — 5 min

    # YOLOv8 confidence
    "yolo_conf": 0.45,

    # YOLO classes we care about (COCO dataset IDs)
    # 67=cell phone, 73=book, 0=person, 84=book (alt), 63=laptop
    "yolo_classes_interest": [0, 63, 67, 73, 84],

    # Phone-in-hand: hand landmark near face AND yolo sees phone
    "hand_face_proximity_ratio": 0.35, # fraction of frame width

    # State history window for smoothing
    "smoothing_window": 6,             # last N samples to majority-vote

    # Display
    "display_width": 960,
    "display_height": 540,
}

# ──────────────────────────────────────────────
# MEDIAPIPE SETUP
# ──────────────────────────────────────────────
mp_face_mesh = mp.solutions.face_mesh
mp_hands     = mp.solutions.hands
mp_drawing   = mp.solutions.drawing_utils
mp_drawing_styles = mp.solutions.drawing_styles

# FaceMesh landmark indices for eyes
# Left eye: 33, 160, 158, 133, 153, 144
# Right eye: 362, 385, 387, 263, 373, 380
LEFT_EYE  = [33, 160, 158, 133, 153, 144]
RIGHT_EYE = [362, 385, 387, 263, 373, 380]

# Nose tip and chin for head pose estimation
NOSE_TIP   = 1
CHIN       = 199
LEFT_EAR   = 234
RIGHT_EAR  = 454
LEFT_EYE_INNER  = 133
RIGHT_EYE_INNER = 362

# ──────────────────────────────────────────────
# HELPERS
# ──────────────────────────────────────────────

def ear(landmarks, eye_indices, w, h):
    """Eye Aspect Ratio from 6 landmark indices."""
    pts = np.array([[landmarks[i].x * w, landmarks[i].y * h] for i in eye_indices])
    # vertical distances
    A = np.linalg.norm(pts[1] - pts[5])
    B = np.linalg.norm(pts[2] - pts[4])
    # horizontal distance
    C = np.linalg.norm(pts[0] - pts[3])
    return (A + B) / (2.0 * C + 1e-6)


def head_pose_angles(landmarks, w, h):
    """
    Estimate yaw (left-right) and pitch (up-down) from face landmarks.
    Returns (yaw_deg, pitch_deg).
    Positive yaw  = face turned right.
    Positive pitch = face looking down.
    """
    nose  = landmarks[NOSE_TIP]
    chin  = landmarks[CHIN]
    l_ear = landmarks[LEFT_EAR]
    r_ear = landmarks[RIGHT_EAR]

    # Yaw: horizontal asymmetry between ears and nose
    nose_x = nose.x
    l_x    = l_ear.x
    r_x    = r_ear.x
    face_width = abs(r_x - l_x) + 1e-6
    # Normalised offset of nose from centre
    yaw_raw = ((nose_x - l_x) / face_width - 0.5) * 2  # -1 to 1
    yaw_deg = yaw_raw * 45  # rough mapping

    # Pitch: vertical position of chin vs nose vs forehead
    nose_y = nose.y
    chin_y = chin.y
    pitch_raw = (chin_y - nose_y) - 0.18  # baseline offset for neutral
    pitch_deg = pitch_raw * 200

    return yaw_deg, pitch_deg


def hand_near_face(hand_results, face_results, frame_w):
    """Returns True if a hand landmark is within proximity of face centre."""
    if not hand_results.multi_hand_landmarks:
        return False
    if not face_results.multi_face_landmarks:
        return False

    face_lm = face_results.multi_face_landmarks[0].landmark
    face_cx = face_lm[NOSE_TIP].x
    face_cy = face_lm[NOSE_TIP].y

    for hand_lm in hand_results.multi_hand_landmarks:
        for lm in hand_lm.landmark:
            dist = math.hypot(lm.x - face_cx, lm.y - face_cy)
            if dist < CFG["hand_face_proximity_ratio"]:
                return True
    return False


STATE_COLORS = {
    "FOCUSED":        (0, 220, 100),
    "DROWSY":         (0, 140, 255),
    "AWAY":           (180, 180, 0),
    "LONG_AWAY":      (80, 80, 80),
    "ON_PHONE":       (0, 0, 220),
    "DISTRACTED":     (0, 165, 255),
    "READING_WRITING":(120, 220, 0),
    "INITIALISING":   (200, 200, 200),
}

QUALITY_MULT = {
    "FOCUSED":        1.0,
    "READING_WRITING":1.1,
    "DISTRACTED":     0.7,
    "DROWSY":         0.5,
    "AWAY":           0.8,
    "LONG_AWAY":      0.0,
    "ON_PHONE":       0.0,
    "INITIALISING":   0.0,
}

# ──────────────────────────────────────────────
# YOLO WORKER (runs in background thread)
# ──────────────────────────────────────────────

class YOLOWorker:
    """
    Accepts frames via submit(), runs inference off the main thread,
    stores latest detections in self.result.
    """
    def __init__(self, model_path="yolov8n.pt"):
        print("[YOLO] Loading model (first run downloads ~6 MB)...")
        self.model = YOLO(model_path)
        self.result = {}          # {"phone": bool, "book": bool, "person": bool}
        self._lock  = threading.Lock()
        self._frame = None
        self._pending = False
        self._thread = threading.Thread(target=self._run, daemon=True)
        self._thread.start()
        print("[YOLO] Ready.")

    def submit(self, frame):
        with self._lock:
            self._frame   = frame.copy()
            self._pending = True

    def get_result(self):
        with self._lock:
            return dict(self.result)

    def _run(self):
        while True:
            frame = None
            with self._lock:
                if self._pending:
                    frame = self._frame
                    self._pending = False
            if frame is not None:
                self._infer(frame)
            time.sleep(0.05)

    def _infer(self, frame):
        results = self.model(
            frame,
            classes=CFG["yolo_classes_interest"],
            conf=CFG["yolo_conf"],
            verbose=False,
        )[0]

        detected = {"phone": False, "book": False, "person": False}
        if results.boxes is not None:
            for box in results.boxes:
                cls = int(box.cls[0])
                if cls == 67:                        # cell phone
                    detected["phone"] = True
                elif cls in (73, 84):                # book
                    detected["book"]  = True
                elif cls == 0:                       # person
                    detected["person"] = True

        with self._lock:
            self.result = detected


# ──────────────────────────────────────────────
# MAIN TRACKER
# ──────────────────────────────────────────────

class ActivityTracker:
    def __init__(self, cam_index=0, log_path=None, show_display=True):
        self.cam_index    = cam_index
        self.log_path     = Path(log_path) if log_path else None
        self.show_display = show_display

        # State
        self.current_state   = "INITIALISING"
        self.state_history   = collections.deque(maxlen=CFG["smoothing_window"])
        self.session_states  = []   # (timestamp, state, quality_mult)

        # Timing
        self.last_face_time       = time.time()
        self.last_sample_time     = 0
        self.last_yolo_periodic   = 0
        self.last_yolo_trigger    = 0
        self.drowsy_frame_count   = 0
        self.distracted_start     = None

        # YOLO
        self.yolo = YOLOWorker()

        # MediaPipe
        self.face_mesh = mp_face_mesh.FaceMesh(
            max_num_faces=1,
            refine_landmarks=True,
            min_detection_confidence=0.5,
            min_tracking_confidence=0.5,
        )
        self.hands = mp_hands.Hands(
            max_num_hands=2,
            min_detection_confidence=0.5,
            min_tracking_confidence=0.5,
        )

        # Stats
        self.frame_count = 0
        self.session_start = datetime.now()

    # ── STATE CLASSIFICATION ──────────────────

    def _classify(self, face_present, avg_ear, yaw, pitch, hand_on_face, yolo_res, now):
        """Core state machine. Returns raw state string."""

        # 1. AWAY / LONG_AWAY — no face
        if not face_present:
            away_sec = now - self.last_face_time
            if away_sec >= CFG["away_long_sec"]:
                return "LONG_AWAY"
            if away_sec >= CFG["away_short_sec"]:
                return "AWAY"
            return self.current_state   # keep last state for first few seconds

        # Face is present — reset away timer
        self.last_face_time = now

        # 2. DROWSY — EAR below threshold for sustained frames
        if avg_ear < CFG["ear_drowsy_threshold"]:
            self.drowsy_frame_count += 1
        else:
            self.drowsy_frame_count = max(0, self.drowsy_frame_count - 1)

        if self.drowsy_frame_count >= CFG["ear_drowsy_frames"]:
            return "DROWSY"

        # 3. ON_PHONE — hand near face AND (yolo sees phone OR pitch looking down)
        phone_in_hand = hand_on_face and (yolo_res.get("phone") or pitch > CFG["pitch_down_deg"] + 5)
        if phone_in_hand:
            return "ON_PHONE"

        # 4. READING_WRITING — pitch down + yolo sees book/papers
        if pitch > CFG["pitch_down_deg"] and yolo_res.get("book"):
            return "READING_WRITING"

        # 5. DISTRACTED — sustained head yaw
        yaw_abs = abs(yaw)
        if yaw_abs > CFG["yaw_distracted_deg"]:
            if self.distracted_start is None:
                self.distracted_start = now
            elif now - self.distracted_start >= CFG["distracted_sustain_sec"]:
                return "DISTRACTED"
        else:
            self.distracted_start = None

        # 6. FOCUSED — default if none of the above
        return "FOCUSED"

    def _smooth_state(self, raw_state):
        """Majority vote over last N samples."""
        self.state_history.append(raw_state)
        counts = collections.Counter(self.state_history)
        return counts.most_common(1)[0][0]

    # ── LOGGING ──────────────────────────────

    def _log(self, state, quality):
        entry = {
            "ts":      datetime.now().isoformat(),
            "state":   state,
            "quality": quality,
        }
        self.session_states.append(entry)
        if self.log_path:
            with open(self.log_path, "a") as f:
                f.write(json.dumps(entry) + "\n")

    # ── DISPLAY ──────────────────────────────

    def _draw_overlay(self, frame, state, avg_ear, yaw, pitch, yolo_res, fps):
        h, w = frame.shape[:2]
        color = STATE_COLORS.get(state, (255, 255, 255))
        quality = QUALITY_MULT.get(state, 0.0)

        # State banner
        cv2.rectangle(frame, (0, 0), (w, 56), (20, 20, 20), -1)
        cv2.putText(frame, f"STATE: {state}", (12, 36),
                    cv2.FONT_HERSHEY_DUPLEX, 1.0, color, 2)

        # Quality pill
        q_txt = f"Quality {quality:.1f}x"
        cv2.putText(frame, q_txt, (w - 200, 36),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.7, color, 2)

        # Metrics panel
        metrics = [
            f"EAR:   {avg_ear:.3f}",
            f"Yaw:   {yaw:+.1f} deg",
            f"Pitch: {pitch:+.1f} deg",
            f"Phone: {'YES' if yolo_res.get('phone') else 'no'}",
            f"Book:  {'YES' if yolo_res.get('book') else 'no'}",
            f"FPS:   {fps:.1f}",
        ]
        for i, txt in enumerate(metrics):
            cv2.putText(frame, txt, (12, 90 + i * 26),
                        cv2.FONT_HERSHEY_SIMPLEX, 0.58, (200, 200, 200), 1)

        # State border flash for alert states
        if state in ("DROWSY", "ON_PHONE"):
            cv2.rectangle(frame, (0, 0), (w - 1, h - 1), color, 4)

        # Session time
        elapsed = int((datetime.now() - self.session_start).total_seconds())
        m, s = divmod(elapsed, 60)
        cv2.putText(frame, f"Session {m:02d}:{s:02d}", (12, h - 14),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.55, (140, 140, 140), 1)

        return frame

    # ── MAIN LOOP ────────────────────────────

    def run(self):
        cap = cv2.VideoCapture(self.cam_index)
        if not cap.isOpened():
            raise RuntimeError(f"Cannot open camera {self.cam_index}")

        cap.set(cv2.CAP_PROP_FRAME_WIDTH, 1280)
        cap.set(cv2.CAP_PROP_FRAME_HEIGHT, 720)
        cap.set(cv2.CAP_PROP_FPS, 30)

        print(f"\n[Tracker] Started. Session: {self.session_start.strftime('%H:%M:%S')}")
        print("[Tracker] Press Q to quit.\n")

        fps_times = collections.deque(maxlen=30)
        avg_ear = 0.3
        yaw = 0.0
        pitch = 0.0
        face_present = False
        hand_on_face = False
        yolo_res = {}

        try:
            while True:
                t0 = time.time()
                ret, frame = cap.read()
                if not ret:
                    print("[Tracker] Frame read failed — retrying...")
                    time.sleep(0.1)
                    continue

                self.frame_count += 1
                now = time.time()
                h, w = frame.shape[:2]

                # ── PERIODIC YOLO ──
                if now - self.last_yolo_periodic >= CFG["yolo_periodic_interval"]:
                    self.yolo.submit(frame)
                    self.last_yolo_periodic = now
                    yolo_res = self.yolo.get_result()

                # ── MEDIAPIPE ──
                rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
                rgb.flags.writeable = False

                face_results = self.face_mesh.process(rgb)
                hand_results = self.hands.process(rgb)

                rgb.flags.writeable = True

                face_present = bool(face_results.multi_face_landmarks)

                if face_present:
                    lm = face_results.multi_face_landmarks[0].landmark

                    left_ear  = ear(lm, LEFT_EYE,  w, h)
                    right_ear = ear(lm, RIGHT_EYE, w, h)
                    avg_ear   = (left_ear + right_ear) / 2.0

                    yaw, pitch = head_pose_angles(lm, w, h)

                    # Triggered YOLO: hand near face
                    hand_on_face = hand_near_face(hand_results, face_results, w)
                    if hand_on_face and (now - self.last_yolo_trigger >= CFG["yolo_trigger_cooldown"]):
                        self.yolo.submit(frame)
                        self.last_yolo_trigger = now
                        yolo_res = self.yolo.get_result()

                    # Triggered YOLO: looking down
                    if pitch > CFG["pitch_down_deg"] and (now - self.last_yolo_trigger >= CFG["yolo_trigger_cooldown"]):
                        self.yolo.submit(frame)
                        self.last_yolo_trigger = now

                # ── STATE SAMPLE ──
                if now - self.last_sample_time >= CFG["state_sample_interval"]:
                    raw   = self._classify(face_present, avg_ear, yaw, pitch, hand_on_face, yolo_res, now)
                    state = self._smooth_state(raw)
                    quality = QUALITY_MULT[state]

                    if state != self.current_state:
                        print(f"[{datetime.now().strftime('%H:%M:%S')}]  {self.current_state:>18s}  →  {state}  (q={quality:.1f}x)")

                    self.current_state = state
                    self._log(state, quality)
                    self.last_sample_time = now

                # ── DISPLAY ──
                fps_times.append(1.0 / max(time.time() - t0, 1e-6))
                fps = sum(fps_times) / len(fps_times)

                if self.show_display:
                    display = cv2.resize(frame, (CFG["display_width"], CFG["display_height"]))
                    display = self._draw_overlay(
                        display, self.current_state, avg_ear, yaw, pitch, yolo_res, fps
                    )
                    cv2.imshow("Activity Tracker", display)
                    if cv2.waitKey(1) & 0xFF == ord("q"):
                        break

        finally:
            cap.release()
            cv2.destroyAllWindows()
            self.face_mesh.close()
            self.hands.close()
            self._print_summary()

    # ── SUMMARY ──────────────────────────────

    def _print_summary(self):
        if not self.session_states:
            return

        duration = (datetime.now() - self.session_start).total_seconds()
        counts = collections.Counter(e["state"] for e in self.session_states)
        total  = len(self.session_states)

        avg_quality = sum(QUALITY_MULT.get(e["state"], 0) for e in self.session_states) / max(total, 1)

        print("\n" + "═" * 48)
        print(f"  SESSION SUMMARY  {self.session_start.strftime('%H:%M')} – {datetime.now().strftime('%H:%M')}")
        print("═" * 48)
        print(f"  Duration   : {int(duration // 60)}m {int(duration % 60)}s")
        print(f"  Avg quality: {avg_quality:.2f}x")
        print(f"  Samples    : {total}")
        print()
        for state, count in counts.most_common():
            pct = count / total * 100
            bar = "█" * int(pct / 4)
            q   = QUALITY_MULT.get(state, 0)
            print(f"  {state:<18s} {pct:5.1f}%  {bar:<25s} q={q:.1f}x")
        print("═" * 48 + "\n")

        if self.log_path:
            print(f"  Log saved → {self.log_path}\n")


# ──────────────────────────────────────────────
# ENTRY POINT
# ──────────────────────────────────────────────

def parse_args():
    p = argparse.ArgumentParser(description="Webcam Activity Tracker")
    p.add_argument("--cam",        type=int,  default=0,           help="Camera index (default 0)")
    p.add_argument("--log",        type=str,  default=None,        help="Path to JSONL log file")
    p.add_argument("--no-display", action="store_true",            help="Run headless (no window)")
    return p.parse_args()


if __name__ == "__main__":
    args = parse_args()
    tracker = ActivityTracker(
        cam_index    = args.cam,
        log_path     = args.log,
        show_display = not args.no_display,
    )
    tracker.run()