import requests
import time

BASE_URL = "http://localhost:8000"
DATASET_PATH = "practice_datasets/AEP_hourly.csv"

QUERY = "Find segments where there is an increase and then a decrease"
WINDOW_LENGTH_VALUES = [7, 14, 21, 30, 60]

TOP_K = 5

def upload_dataset(filepath, window_length):
    with open(filepath, 'rb') as f:
        files = {'file': (filepath, f, 'text/csv')}
        params = {'top_k': TOP_K, 'window_length': window_length}
        response = requests.post(f"{BASE_URL}/uploadfile/", files=files, params=params)
        return response.ok

def run_query(window_length):
    payload = {
        "query": QUERY,
        "window_length": window_length,
        "top_k": TOP_K,
    }
    start_time = time.time()
    response = requests.post(f"{BASE_URL}/user-query", json=payload)
    end_time = time.time()

    latency = (end_time - start_time) * 1000  # ms
    if response.status_code == 200:
        try:
            json_data = response.json()
            match_count = len(json_data.get("Matched Segments", []))
        except:
            match_count = 0
        return latency, match_count
    else:
        print("Error:", response.status_code, response.text)
        return latency, 0

def test_window_length_sensitivity():
    print("=== Window Length Sensitivity Test ===")
    for window_length in WINDOW_LENGTH_VALUES:
        print(f"\nTesting window_length={window_length}")
        if upload_dataset(DATASET_PATH, window_length):
            latency, match_count = run_query(window_length)
            print(f"Latency: {latency:.2f} ms | Matches: {match_count}")
        else:
            print("❌ Upload failed.")

if __name__ == "__main__":
    test_window_length_sensitivity()
