import requests
import time
import random

BASE_URL = "http://localhost:8000"

test_queries = [
    "Find segments where volume is high and then falls",
    "Identify phases of steady temperature rise followed by sudden drop",
    "Track periods of high consumer interest followed by a sudden drop",
    "Identify when energy consumption spikes to high levels and stabilizes",
    "Show parts where there is a symmetrical rise and fall",
]

N_TRIALS = 20

def measure_latency(endpoint="/extract-features-only", queries=test_queries, n_trials=N_TRIALS):
    latencies = []

    print(f"Starting latency test: {n_trials} queries to {endpoint}\n")

    for _ in range(n_trials):
        query_text = random.choice(queries)

        payload = {
            "query": query_text,
            "window_length": 5,
            "top_k": 5,  # Still required by QueryRequest schema, even if unused
        }

        try:
            start_time = time.time()
            response = requests.post(f"{BASE_URL}{endpoint}", json=payload)
            end_time = time.time()

            if response.status_code == 200:
                latency = (end_time - start_time) * 1000  # milliseconds
                latencies.append(latency)
                print(f"{latency:.2f}")
            else:
                print(f"Error: {response.status_code} - {response.text}")

        except Exception as e:
            print(f"Exception: {e}")

    if latencies:
        avg_latency = sum(latencies) / len(latencies)
        print("\n✅ Feature-Only Latency Test Results:")
        print(f"Average Latency: {avg_latency:.2f} ms")
        print(f"Min Latency: {min(latencies):.2f} ms")
        print(f"Max Latency: {max(latencies):.2f} ms")
    else:
        print("No successful queries to measure.")

if __name__ == "__main__":
    measure_latency()
