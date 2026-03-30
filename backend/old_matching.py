import logging
from fastapi import FastAPI, UploadFile, File, HTTPException
from fastapi.middleware.cors import CORSMiddleware
import pandas as pd
import numpy as np
from scipy.spatial.distance import euclidean
from fastdtw import fastdtw

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = FastAPI()


origins = [
    "http://localhost:3000",
]
app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

time_series_data = []

@app.post("/uploadfile/")
async def upload_file(file: UploadFile = File(...)):
    global time_series_data
    try:
        logger.info("Received file upload request")
        df = pd.read_csv(file.file)
        

        if len(df.columns) >= 2:
            df.columns = ['Date', 'Value'] + list(df.columns[2:])
        else:
            raise ValueError("CSV must have at least two columns for Date and Value")

        df['Date'] = pd.to_datetime(df['Date'], errors='coerce')
        df = df.dropna(subset=['Date', 'Value'])
        df['Value'] = pd.to_numeric(df['Value'], errors='coerce')
        df = df.dropna(subset=['Value'])
        time_series_data = df.to_dict(orient="records")
        logger.info("File uploaded and processed successfully")
        logger.info(f"Time series data: {time_series_data[:5]}")
        return {"message": "File uploaded successfully"}
    except Exception as e:
        logger.error(f"File upload failed: {str(e)}")
        raise HTTPException(status_code=500, detail=f"File upload failed: {str(e)}")

@app.get("/get-data/")
async def get_data():
    try:
        if not time_series_data:
            raise HTTPException(status_code=404, detail="No data found")
        logger.info(f"Sending time series data: {time_series_data[:5]}")
        return time_series_data
    except Exception as e:
        logger.error(f"Error in get_data: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Error retrieving data: {str(e)}")

@app.post("/query-sketch/")
async def query_sketch(data: dict):
    try:
        logger.info("Received sketch query request")
        sketch = data["sketch"]
        logger.info(f"Sketch data received: {sketch}")
        results = perform_sketch_query(sketch, time_series_data)
        logger.info(f"Sketch query results: {results[:1]}")
        return {"predicted_query": "Matched results", "data": results}
    except Exception as e:
        logger.error(f"Query failed: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Query failed: {str(e)}")

def perform_sketch_query(sketch, time_series_data):
    try:
        logger.info(f"Performing sketch query with time_series_data of length {len(time_series_data)}")
        sketch_points = [(point['x'], point['y']) for point in sketch]
        logger.info(f"Sketch points: {sketch_points}")

        matches = []
        for i in range(len(time_series_data) - len(sketch_points) + 1):
            series_points = [(j, time_series_data[i + j]['Value']) for j in range(len(sketch_points))]
            logger.info(f"Comparing sketch to series_points: {series_points}")

            distance, _ = fastdtw(sketch_points, series_points, dist=euclidean)
            logger.info(f"Distance: {distance}")
            matches.append((time_series_data[i:i + len(sketch_points)], distance))

        matches.sort(key=lambda x: x[1])
        logger.info(f"Top matches: {matches[:5]}")
        return [match[0] for match in matches[:5]]
    except Exception as e:
        logger.error(f"Error in perform_sketch_query: {str(e)}")
        raise