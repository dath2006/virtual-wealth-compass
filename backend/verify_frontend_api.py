import urllib.request
import json
import time

BASE_URL = "http://localhost:8000"
API_KEY = "9a2b3c4d5e6f7g8h9i0j1k2l3m4n5o6p"

def make_request(path, method="GET", body=None):
    url = f"{BASE_URL}{path}"
    data = json.dumps(body).encode("utf-8") if body else None
    
    req = urllib.request.Request(
        url,
        data=data,
        headers={
            "Content-Type": "application/json",
            "X-API-Key": API_KEY
        },
        method=method
    )
    
    try:
        with urllib.request.urlopen(req) as response:
            res_body = response.read().decode("utf-8")
            print(f"{method} {path} -> Status: {response.status}")
            safe_body = res_body.encode('ascii', errors='replace').decode('ascii')
            print(f"Response: {safe_body[:400]}...\n")
            return json.loads(res_body)
    except urllib.error.HTTPError as e:
        print(f"{method} {path} -> Failed: {e.code} {e.reason}")
        print(f"Error Response: {e.read().decode('utf-8')}\n")
        return None
    except Exception as e:
        print(f"{method} {path} -> Error: {str(e)}\n")
        return None

def main():
    print("=== STARTING FRONTEND API INTEGRATION TESTS ===\n")
    
    # Test GET routes
    make_request("/health")
    make_request("/ledger")
    make_request("/balance")
    make_request("/sessions")
    make_request("/stats/daily")
    make_request("/stats/streak")
    make_request("/credit")
    make_request("/mercy")
    make_request("/device")
    make_request("/settings")
    make_request("/bosses")
    make_request("/usage/today")
    
    # Test POST bosses
    print("--- Testing Boss Fight Creation ---")
    boss_payload = {
        "title": "OS Mid Sem Challenge",
        "target_hours": 10.0,
        "deadline_ms": int((time.time() + 86400 * 5) * 1000), # 5 days from now
        "loot_type": "RUPEE_PAYOUT",
        "loot_value": 300
    }
    boss_res = make_request("/bosses", method="POST", body=boss_payload)
    
    if boss_res:
        make_request("/bosses") # list bosses again to verify inclusion
        
    # Test POST oaths
    print("--- Testing Oath Creation & Payout ---")
    oath_payload = {
        "task": "Read OS chapter 4 notes",
        "loanAmount": 400,
        "dueMs": int((time.time() + 86400 * 3) * 1000) # 3 days from now
    }
    oath_res = make_request("/oaths", method="POST", body=oath_payload)
    
    if oath_res:
        oath_id = oath_res["id"]
        # Query ledger & balance to verify credit
        make_request("/balance")
        
        # Test Repayment of this oath
        print(f"--- Repaying Oath ID: {oath_id} ---")
        make_request(f"/oaths/{oath_id}/repay", method="POST")
        
        # Verify ledger and credit score updates
        make_request("/balance")
        make_request("/credit")

    print("=== TESTS COMPLETE ===")

if __name__ == "__main__":
    main()
