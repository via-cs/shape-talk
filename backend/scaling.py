import requests
import time

BASE_URL = "http://localhost:8000"

FILES = {
    "medium1": "practice_datasets/BTCUSD.csv",
    "medium2": "practice_datasets/Weather.csv",
    "large": "practice_datasets/AEP_hourly.csv",
}

QUERY = "Find segments where data is generally low with an increase and then a decrease"
WINDOW_LENGTH = 6
TOP_K = 5
N_TRIALS = 20

def upload_dataset(filepath):
    with open(filepath, 'rb') as f:
        files = {'file': (filepath, f, 'text/csv')}
        params = {'top_k': TOP_K, 'window_length': WINDOW_LENGTH}
        response = requests.post(f"{BASE_URL}/uploadfile/", files=files, params=params)
        return response.ok

def run_query():
    payload = {
        "query": QUERY,
        "window_length": WINDOW_LENGTH,
        "top_k": TOP_K,
    }
    start_time = time.time()
    response = requests.post(f"{BASE_URL}/user-query", json=payload)
    end_time = time.time()

    latency = (end_time - start_time) * 1000  # ms

    match_count = 0
    if response.status_code == 200:
        try:
            json_data = response.json()
            raw = json_data.get("Matched Segments", [])
            if isinstance(raw, list):
                match_count = len(raw)
            elif isinstance(raw, dict) and "segments" in raw:
                match_count = len(raw["segments"])
            else:
                print("Unexpected format for Matched Segments:", type(raw), raw)
        except Exception as e:
            print("Failed to parse response:", e)
    else:
        print("Error:", response.status_code, response.text)

    return latency, match_count

def test_scaling():
    print("=== Dataset Scaling Test ===")
    for size, path in FILES.items():
        print(f"\nTesting with {size} dataset...")
        try:
            if not upload_dataset(path):
                print(f"❌ Failed to upload {size} dataset.")
                continue
        except FileNotFoundError:
            print(f"❌ File not found: {path}")
            continue

        latencies = []
        match_counts = []
        for i in range(N_TRIALS):
            latency, match_count = run_query()
            latencies.append(latency)
            match_counts.append(match_count)
            print(f"  Trial {i+1:02d}: {latency:.2f} ms, Matches: {match_count}")

        avg_latency = sum(latencies) / N_TRIALS
        avg_matches = sum(match_counts) / N_TRIALS
        print(f"\n✅ {size.title()} Dataset Results over {N_TRIALS} trials:")
        print(f"   → Avg Latency: {avg_latency:.2f} ms")
        print(f"   → Avg Matches: {avg_matches:.1f}")

if __name__ == "__main__":
    test_scaling()
