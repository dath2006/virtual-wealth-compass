import urllib.request
import json
import time

BASE_URL = "http://localhost:8000/events"
API_KEY = "9a2b3c4d5e6f7g8h9i0j1k2l3m4n5o6p"
DEVICE_ID = "pixel_8a_test"

def send_event(endpoint, payload_data, event_type):
    envelope = {
        "device_id": DEVICE_ID,
        "timestamp_ms": int(time.time() * 1000),
        "event_type": event_type,
        "payload": payload_data
    }
    
    req = urllib.request.Request(
        f"{BASE_URL}{endpoint}",
        data=json.dumps(envelope).encode("utf-8"),
        headers={
            "Content-Type": "application/json",
            "X-API-Key": API_KEY
        },
        method="POST"
    )
    
    try:
        with urllib.request.urlopen(req) as response:
            res_body = response.read().decode("utf-8")
            print(f"POST {endpoint} -> Status: {response.status}")
            # Replace characters that cannot be printed on local console
            safe_body = res_body.encode('ascii', errors='replace').decode('ascii')
            print(f"Response: {safe_body}\n")
            return json.loads(res_body)
    except urllib.error.HTTPError as e:
        print(f"POST {endpoint} -> Failed: {e.code} {e.reason}")
        print(f"Error Response: {e.read().decode('utf-8')}\n")
        return None
    except Exception as e:
        print(f"POST {endpoint} -> Error: {str(e)}\n")
        return None

def main():
    print("=== STARTING EVENT INGESTION INTEGRATION TESTS ===\n")
    
    # 1. Test /events/heartbeat
    print("1. Testing Heartbeat Ingestion...")
    heartbeat_payload = {
        "battery_pct": 85,
        "is_charging": False,
        "service_uptime_ms": 120000
    }
    send_event("/heartbeat", heartbeat_payload, "HEARTBEAT")
    
    # 2. Test /events/steps
    print("2. Testing Steps Ingestion...")
    steps_payload = {
        "steps_today": 8200,
        "date": "2026-06-11"
    }
    send_event("/steps", steps_payload, "STEPS_UPDATE")
    
    # 3. Test /events/upi (Discretionary spend - Swiggy)
    print("3. Testing UPI Debit (Swiggy - should trigger Discretionary 1.0x penalty)...")
    upi_payload = {
        "amount_rupees": 250,
        "merchant_name": "Swiggy",
        "raw_text": "Paid Rs. 250 to Swiggy on UPI",
        "source": "NOTIFICATION",
        "dedup_key": f"swiggy_dedup_{int(time.time())}"
    }
    send_event("/upi", upi_payload, "UPI_DEBIT")
    
    # 3b. Test /events/upi (AI path - Zara)
    print("3b. Testing UPI Debit (Zara - should trigger AI classification)...")
    upi_payload_zara = {
        "amount_rupees": 1500,
        "merchant_name": "Zara",
        "raw_text": "Paid Rs. 1500 to Zara on UPI",
        "source": "NOTIFICATION",
        "dedup_key": f"zara_dedup_{int(time.time())}"
    }
    send_event("/upi", upi_payload_zara, "UPI_DEBIT")
    
    # 4. Test UPI deduplication
    print("4. Testing UPI Duplicate Debit Ingestion...")
    send_event("/upi", upi_payload, "UPI_DEBIT")  # same payload and dedup_key

    # 5. Test NFC Tap Start
    print("5. Testing NFC Focus Tag Tap (Start Session)...")
    nfc_payload = {
        "tag_id": "tag_nfc_desk_abc123",
        "tag_label": "Study Desk Tag"
    }
    res_start = send_event("/nfc", nfc_payload, "NFC_SESSION_START")
    
    # 6. Test NFC Tap Stop (too short)
    print("6. Testing NFC Tag Tap (Stop Session - immediately)...")
    send_event("/nfc", nfc_payload, "NFC_SESSION_STOP")

    print("=== TESTS COMPLETE ===")

if __name__ == "__main__":
    main()
