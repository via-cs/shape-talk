import logging
from fastapi import FastAPI, UploadFile, File, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
import pandas as pd
import numpy as np
from scipy.spatial.distance import euclidean
from fastdtw import fastdtw
from typing import List, Optional
from pydantic import BaseModel
import os
import openai
from matching import *
from datetime import datetime
from tslearn.metrics import dtw_path_from_metric
from multiprocessing import Pool
import json
import asyncio
from typing import Dict, List, Optional, Any
import httpx
from scipy.stats import skew, kurtosis
from scipy.stats import linregress
import time
from config import API_KEY

time_series_data = []
raw_time_series_data = []
segment_window_list = []
prev_window_size = 7

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = FastAPI()

origins = [
    "http://localhost:3000",
]
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
time_series_data = []
segmented_data = []

PRACTICE_DATASETS = {
    "AEP_hourly.csv": "practice_datasets/AEP_hourly.csv",
    "BTCUSD.csv": "practice_datasets/BTCUSD.csv",
    "Weather.csv": "practice_datasets/Weather.csv"
}
UPLOAD_FOLDER = "uploaded_files"

global_parameters = {'high': 0.7,
 'high_explanation': 'Default',
 'low': 0.3,
 'low_explanation': 'Default',
 'variance': 0.1,
 'variance_explanation': 'Default'}

local_parameters = {'is_linear': 2.75e-05, 'is_linear_explanation': 'The threshold is set based on the variance of slopes being consistently low across segments, indicating a linear trend.', 
                    'is_constant': 0.0003, 'is_constant_explanation': 'The threshold is determined by the variance of segments with minimal variation, indicating constant behavior.', 
                    'is_smooth': 0.0003, 'is_smooth_explanation': 'The threshold is chosen based on low variance values that suggest a smooth pattern.', 
                    'is_noisy': 0.002, 'is_noisy_explanation': 'The threshold is based on higher variance values that indicate noisy segments.', 
                    'is_complex': 0.002, 'is_complex_explanation': 'The threshold is set according to high variance and multiple peaks that signify complex patterns.', 
                    'is_simple': 0.0003, 'is_simple_explanation': 'The threshold is determined by low variance and absence of peaks, indicating simple patterns.', 
                    'is_spiky': 0.02, 'is_spiky_explanation': 'The threshold is chosen based on the magnitude of sudden sharp changes indicating spikes.', 
                    'is_dropout': 0.0005, 'is_dropout_explanation': 'The threshold is set to identify segments where values drop significantly below typical magnitudes.', 
                    'is_periodic': 0.1, 'is_periodic_explanation': 'The threshold is based on the presence of noticeable repeating frequency components indicating periodicity.', 
                    'is_step': 0.02, 'is_step_explanation': 'The threshold is chosen based on the magnitude of sudden jumps indicating steps.', 
                    'is_high_amplitude': 0.015, 'is_high_amplitude_explanation': 'The threshold is based on segments with large differences between max and min values indicating high amplitude.', 
                    'is_high_volume': 10, 'is_high_volume_explanation': 'The threshold is set according to segments with high overall magnitude indicating high volume.', 
                    'is_low_volume': 0.03, 'is_low_volume_explanation': 'The threshold is chosen based on segments with low overall magnitude indicating low volume.'}

########################################################################################################
# Feature descriptions (concise ~30-word summaries for UI popovers)
# These can be edited later in the UI; used read-only by the GET /parameters endpoint.
feature_descriptions = {
    "global": {
        "high": "Segments whose mean value is relatively high versus the dataset. Controlled by the high threshold; raise to be stricter, lower to include more segments.",
        "low": "Segments whose mean value is relatively low versus the dataset. Controlled by the low threshold; lower to be stricter, raise to include more segments.",
        "typical": "Segments whose mean falls between low and high thresholds, representing central tendency. Adjust both low and high to tune the typical band width.",
        "unusual": "Segments whose mean falls beyond low and high thresholds, representing outliers. Adjust both low and high to tune the typical band width."
    },
    "local": {
        "rising": "Values increase consistently across the subsegment, indicated by positive first differences throughout, capturing sustained upward trends without parameter tuning.",
        "falling": "Values decrease consistently across the subsegment, indicated by negative first differences throughout, capturing sustained downward trends without parameter tuning.",
        "concave": "Second differences are positive across the subsegment, producing a U-shaped curvature characteristic of acceleration upward and deceleration downward.",
        "convex": "Second differences are negative across the subsegment, producing an upside-down U curvature characteristic of deceleration upward and acceleration downward.",
        "linear": "Rate of change remains stable; measured by low variance of slopes. Controlled by is_linear; decrease to demand straighter lines, increase to allow mild curvature.",
        "non-linear": "Rate of change varies meaningfully; measured by high slope variance. Uses is_linear as the boundary; lower boundary makes non-linear easier to trigger.",
        "constant": "Values vary minimally across the subsegment. Controlled by is_constant; lower to demand near-flat behavior, higher to allow small fluctuations.",
        "smooth": "Variation is small without abrupt changes. Controlled by is_smooth; lower for stricter smoothness, higher to tolerate more variance as still smooth.",
        "noisy": "Variation is large with frequent fluctuations. Controlled by is_noisy; lower threshold flags more segments as noisy, higher flags only very volatile ones.",
        "complex": "High variability with multiple peaks. Controlled by is_complex; requires large variance and several peaks to indicate intricate dynamics.",
        "simple": "Low variability and no evident peaks. Controlled by is_simple; lower requires very flat, peakless shapes; higher tolerates small wiggles.",
        "spiky": "Contains at least one spike with large adjacent change. Controlled by is_spiky; lower to detect subtle spikes, higher for only sharp spikes.",
        "dropout": "Contains unusually small value(s) compared to typical magnitude. Controlled by is_dropout; raise to detect only extreme drops, lower to include moderate dips.",
        "periodic": "Exhibits repeating components in frequency space. Controlled by is_periodic; lower reveals subtler periodicity, higher captures only strong cycles.",
        "aperiodic": "Lacks strong repeating frequency components. Uses is_periodic as ceiling; raise to require stronger periodic signals to exclude aperiodic.",
        "symmetric": "Approximately mirror-symmetric around the center of the subsegment, reflecting balanced rise and fall behavior without threshold parameters.",
        "asymmetric": "Lacks mirror symmetry across the subsegment, indicating unbalanced rises and falls; computed as the complement of symmetric without thresholds.",
        "step": "Contains a sudden jump in value. Controlled by is_step; lower to detect subtle steps, higher to restrict to large discontinuities.",
        "no-step": "No sudden jumps above the step threshold. Uses is_step as the boundary; higher threshold classifies more segments as no-step.",
        "high-amplitude": "Large difference between maximum and minimum. Controlled by is_high_amplitude; lower to catch milder swings, higher to capture only strong swings.",
        "low-amplitude": "Small difference between maximum and minimum. Controlled by is_low_amplitude; lower to demand very small ranges, higher to allow modest ranges.",
        "high-volume": "High accumulated magnitude over the subsegment. Controlled by is_high_volume; raise to require stronger overall activity, lower to include moderate activity.",
        "low-volume": "Low accumulated magnitude over the subsegment. Controlled by is_low_volume; lower to demand very quiet segments, higher to include mildly active ones."
    }
}
########################################################################################################



chat_messages = [
{
  "role": "system",
  "content": '''You are an AI assistant that only handles conversations related to time series data. Your task is of the following

1. Assist researchers in the analysis of time series data
2. Answer questions related to the time series data based on meta data
3. Determine whether a user input is a command or a general message
4. Describe lines the user sketched
5. Only respond to time series–related content. 
6. Provide the user with some general instructions on how to use this LLM

2. Answer questions related to the time series data based on meta data
You must answer questions the user have based on the meta data of the time series data. The user will provide you the meta data

4. Describe lines the user sketched
The user will give a list of y-values that form a line when connected. In one sentence, describe the big picture trends of the line using natural language. Focus on how the line generally change and combine related traits using "and" when needed. Keep it high-level and avoid going into too much detail or using specific numbers.
In addition, Since the list of y-values are taken from a human hand drawn line, there may be small unintended spikes or jitter can occur due to hand instability or digitization noise, please also account for them. 

3. Input Classification and Output Formatting
You must determine whether the user's input is a command or a general message, and label it accordingly:
If the input is a direct query or instruction related to time series patterns, segments, or behavior (e.g., “show all rising lines”, “highlight flat segments”, “list all peaks and troughs”), then classify it as a command.
Prefix the response with [CMD] and repeat the original user input. In addition identify the window length the user is trying to query if the user has one. If a user says show me a 3 day rising. You must return [CMD] user input [WINDOW] list[window]. Another Example: A user could say show me rising for 3 days and falling for 2 days. You return [CMD] show me rising for 3 days and falling for 2 days [WINDOW] [3,2]
For all other time series–related inputs (e.g., observations, questions, or comments like “why is this segment noisy?”), classify it as a general message.
Prefix the response with [MSG] and respond naturally to the message.
The output must always begin with either [CMD] or [MSG]. No other formats are allowed.
If the user input is not related to time series, respond with:
"[MSG] This request is outside the scope of time series analysis and cannot be processed."

5. Only respond to time series–related content.
This includes general questions about time series data, analysis methods, or specific datasets that represent time series.
If the input is not related to time series, respond with:
'[MSG] This request is outside the scope of time series analysis and cannot be processed.' 

6. Provide the user with some general instructions on how to use this LLM if the user types help or asks for help.
    1. Select or upload a dataset 
    2. You can query about general statistics about dataset by typing "what is the [XXX]", "tell me about [XXX]", "summarize this dataset for me", etc
    3. You can query segements by using natural language by typing "show me all segments that [XXX]", "select all lines [XXX]". You can query segements with mutiple properties by using key words such as "then". "show me all segments that rises then falls".
    4. You can ask me to describe your sketch in natural language.
Do not elaborate beyond these examples. If the user asks for help, respond only with this list
'''
},

]



openai_client = openai.OpenAI(max_retries=0, api_key=API_KEY)
#########################################################################################
# parameter functions

def create_windows(series, window_size, step_size):
    result = []
    i = 0
    for i in range(0, len(series) - window_size + 1, step_size):
        result.append(series[i:i + window_size])
    if i < len(series) - window_size:
        result.append(series[i + window_size:])
    return result

def global_numerical_summarization(data):
    summary = []
    for i in range(len(data)):
        tmp = dict()
        x = np.arange(len(data[i]))
        slope, intercept, r_value, p_value, std_err = linregress(x, data[i])
        stats = {
            "mean": np.mean(data[i]),
            "median": np.median(data[i]),
            "std": np.std(data[i]),  
            "min": np.min(data[i]),
            "max": np.max(data[i]),
            "range": np.max(data[i]) - np.min(data[i]),
            "skewness": skew(data[i]),
            "kurtosis": kurtosis(data[i], fisher=True),
            "slope": slope,
            "length": len(data[i])
        }
        tmp[f'segment {i}'] = stats
        summary.append(tmp)
    return summary

def format_numbers(summary):
    formatted = []
    for entry in summary:
        new_entry = {}
        for label, stats in entry.items():
            new_stats = {}
            for stat_name, value in stats.items():
                new_stats[stat_name] = float(f"{value:.2e}")
            new_entry[label] = new_stats
        formatted.append(new_entry)
    return formatted

def global_auto_determination(data):
    prompt ='''You are an AI assistant designed to support analysts and researchers in interpreting time series data from natural language queries.

Your ONLY task is to compute dynamic threshold values for key statistical features based on the provided data. Do NOT generate or reformulate queries. Do NOT modify the input.

The input is a list of dictionaries, where each dictionary represents one segment of a time series with the following numerical features:
"mean", "median", "std", "min", "max", "range", "skewness", "kurtosis", and "slope", length

Your job is to determine:
"high": a threshold such that approximately 70% of all "mean" values are below this value.
"low": a threshold such that approximately 30% of all "mean" values are below this value.
"variance": a threshold based on "std" that distinguishes segments with tightly clustered values from the rest.

All thresholds must be derived directly from the provided feature values using consistent statistical logic (e.g., percentiles or variance spread).

Return your output as a plain dictionary. Do NOT use markdown, code formatting, or any extra text.

Use the following format exactly:

{"high": VALUE, "high_explanation": "Explain your choice of high in one sentence using only words.",
"low": VALUE, "low_explanation": "Explain your choice of low in one sentence using only words.",
"variance": VALUE, "variance_explanation": "Explain your choice of variance in one sentence using only words."}

Here is the data:
'''
    prompt += str(data)
    #print(prompt)
    client = openai_client
    chat_completion = client.chat.completions.create(###chat_completion is the returned
        messages=[
            {"role": "system", "content": "You are an AI assistant."},
            {"role": "user", "content": prompt}
        ],
    
        model="gpt-4o",
        temperature=0.7,
        max_tokens=150,
        stop=None,
        stream=False,
    )
    predicted_features = chat_completion.choices[0].message.content.strip()
    return predicted_features

async def global_llm_parameter_determination(normalized, user_window_length):
    global global_parameters
    await asyncio.sleep(2)
    data_list = normalized
    window_size = len(data_list)//100 + 1
    final_window_size = window_size

    # default 100 patches if user use default window size
    # if user uses their own window size use user window
    if window_size > user_window_length and user_window_length == 6:
        patches = create_windows(normalized, window_size, window_size)
    else:
        patches = create_windows(normalized, user_window_length, user_window_length)
        window_size = user_window_length
    statistical_summary = global_numerical_summarization(patches)
    statistical_summary = format_numbers(statistical_summary) #reduce trailing numbers
    print(f"patches:{len(patches)}")
    print(f"window_size:{final_window_size}")
    print(f"user_window_length:{user_window_length}")
    print(f"estimated_tokens{len(str(statistical_summary))//5}")
    #print(statistical_summary[0:5])
    #print(patches[0:3])
    #print(normalized[0:30])
    result_text = global_auto_determination(statistical_summary)
    global_parameters = json.loads(result_text)    
    # print(f"patches:{len(patches)}")
    # print(f"window_size:{window_size}")
    # print(f"user_window_length:{user_window_length}")
    print(global_parameters)



def local_numerical_summarization(data):
    summary = []
    for i in range(len(data)):
        tmp = dict()
        x = np.arange(len(data[i]))
        slope, intercept, r_value, p_value, std_err = linregress(x, data[i])
        stats = {
            "mean": np.mean(data[i]),
            "median": np.median(data[i]),
            "std": np.std(data[i]),  
            "min": np.min(data[i]),
            "max": np.max(data[i]),
            "range": np.max(data[i]) - np.min(data[i]),
            "skewness": skew(data[i]),
            "kurtosis": kurtosis(data[i], fisher=True),
            "slope": slope,
            "volume":np.sum(data[i]),
            "length": len(data[i])
        }
        tmp[f'segment {i}'] = stats
        summary.append(tmp)
    return summary

def local_auto_determination(data):
    prompt ='''You are an AI assistant designed to support analysts and researchers in interpreting time series data from natural language queries.

Your ONLY task is to compute dynamic threshold values for key statistical features based on the provided data and suggest a window size for each feature. The window size is an integer. Do NOT generate or reformulate queries. Do NOT modify the input.
For each feature, suggest an appropriate window size based on the statistical characteristics of the data. Use smaller window sizes for smaller datasets and larger window sizes for larger datasets. For features such as rising (continuously increasing) and falling (continuously decreasing), ensure the suggested window sizes are sufficient to capture meaningful trends and produce valid results. Keep in mind that there might be composite queries so keep window size very small for rising_window_size, falling_window_size for smaller datasets 

The input is a list of dictionaries, where each dictionary represents one segment of a time series with the following numerical features:
"mean", "median", "std", "min", "max", "range", "skewness", "kurtosis", "slope", volume, length

Here are the helper functions:
def slope(segment):
    return np.diff(segment)

def variance(segment):
    return np.var(segment)

def amplitude(segment):
    return np.max(segment) - np.min(segment)

def volume(segment):
    return np.sum(np.abs(segment))

Your job is to dynamically determine VALUE based on the definition of these functions:
The function is_linear identifies segments where the rate of change varies very little compared to other segments, suggesting a relatively consistent and straight trend.
def is_linear(segment):
    return variance(slope(segment)) < is_linear_VALUE

The function is_constant identifies segments where the values show minimal variation compared to other segments, indicating a relatively flat or unchanging pattern.
def is_constant(segment):   
    return variance(segment) < is_constant_VALUE

The function is_smooth identifies segments with relatively low variation in values compared to others, indicating a gentle and stable pattern without sharp fluctuations.
def is_smooth(segment):
    return variance(segment) < is_smooth_VALUE

The function is_noisy identifies segments with relatively high variation in values compared to others, indicating a pattern with frequent or abrupt fluctuations.
def is_noisy(segment):
    return variance(segment) > is_noisy_VALUE

The function is_complex identifies segments that show both high variability and multiple peaks compared to other segments, indicating a pattern with rich or intricate fluctuations.
def is_complex(segment):
    return variance(segment) > is_complex_VALUE and len(find_peaks(segment)[0]) > 2

The function is_simple identifies segments with low variability and no prominent peaks compared to other segments, indicating a relatively plain and uniform pattern.
def is_simple(segment):
    return variance(segment) < is_simple_VALUE and len(find_peaks(segment)[0]) == 0
    
The function is_spiky identifies segments that contain at least one peak and show sudden sharp changes in value. It identifies segments that contain sudden, isolated spikes.
def is_spiky(segment):
    peaks, _ = find_peaks(segment)
    return len(peaks) > 0 and np.any(np.abs(np.diff(segment)) > is_spiky_VALUE)

The function is_dropout identifies segments that contains at least one point x such that x is significantly smaller than the typical magnitude of the data
def is_dropout(segment):
    return any(x < is_dropout_VALUE for x in segment)

The function is_periodic identifies segments that exhibit noticeable repeating frequency components, indicating a relatively regular or cyclical pattern compared to other segments.
def is_periodic(segment):
    freq = np.abs(fft(segment))
    return np.any(freq > is_periodic_VALUE)

The function is_step identifies segments that contain at least one sudden and significant jump in value, indicating a relatively abrupt change or shift in the data.
def is_step(segment):
    return any(np.abs(np.diff(segment)) > is_step_VALUE)

The function is_high_amplitude identifies segments with relatively large differences between their highest and lowest values, indicating strong fluctuations or pronounced peaks and troughs.
def is_high_amplitude(segment):
    return amplitude(segment) > is_high_amplitude_VALUE

The function is_high_volume detects segments that exhibit relatively strong intensity or activity, based on their overall magnitude or energy being higher than typical segments.
def is_high_volume(segment):
    return volume(segment) > is_high_volume_VALUE

The function is_low_volume identifies segments with a relatively small magnitude or energy, indicating a weak or subdued pattern compared to other segments.
def is_low_volume(segment):
    return volume(segment) < is_high_volume_VALUE

Checks whether the values in the segment consistently increase over time (overall upward trend).
def is_rising(segment):
    return all(slope(segment) > 0)

Checks whether the values in the segment consistently decrease over time (overall downward trend).
def is_falling(segment):
    return all(slope(segment) < 0)

Checks whether the slope of the segment steadily decreases, forming a curve that bends downward (concave shape).
def is_concave(segment):
    return np.all(np.diff(slope(segment)) < 0)

Checks whether the slope of the segment steadily increases, forming a curve that bends upward (convex shape).
def is_convex(segment):
    return np.all(np.diff(slope(segment)) > 0)

Checks whether the segment is mirror-symmetric around its center by comparing the first half with the reversed second half.
def is_symmetric(segment):
    n = len(segment)
    return np.allclose(segment[:n // 2], segment[-(n // 2):][::-1])

Checks whether the segment is not symmetric around its center (i.e., it does not mirror itself).
def is_asymmetric(segment):
    return not is_symmetric(segment)

All thresholds must be derived directly from the provided feature values using consistent statistical logic.
All window must be derived directly based on provided feature functions and data. Try to suggest window size so apparent patterns show up.

Return your output as a plain dictionary. Do NOT use markdown, code formatting, or any extra text.

Use the following format exactly:

{"is_linear": is_linear_VALUE, "is_linear_explanation": "Explain your choice in one sentence using only words.", "linear_window_size": integer suggestion for is_linear feature,
"is_constant": is_constant_VALUE, "is_constant_explanation": "Explain your choice in one sentence using only words.", "constant_window_size": integer suggestion for is_constant feature,
"is_smooth": is_smooth_VALUE, "is_smooth_explanation": "Explain your choice in one sentence using only words.", "smooth_window_size": integer suggestion for is_constant feature,
"is_noisy": is_noisy_VALUE, "is_noisy_explanation": "Explain your choice in one sentence using only words.", "noisy_window_size": integer suggestion for is_noisy feature,
"is_complex": is_complex_VALUE, "is_complex_explanation": "Explain your choice in one sentence using only words.", "complex_window_size": integer suggestion for is_complex feature,
"is_simple": is_simple_VALUE, "is_simple_explanation": "Explain your choice in one sentence using only words.", "simple_window_size": integer suggestion for is_simple feature,
"is_spiky": is_spiky_VALUE, "is_spiky_explanation": "Explain your choice in one sentence using only words.", "spiky_window_size": integer suggestion for is_spiky feature,
"is_dropout": is_dropout_VALUE, "is_dropout_explanation": "Explain your choice in one sentence using only words.", "dropout_window_size": integer suggestion for is_dropout feature,
"is_periodic": is_periodic_VALUE, "is_periodic_explanation": "Explain your choice in one sentence using only words.", "periodic_window_size": integer suggestion for is_periodic feature,
"is_step": is_step_VALUE, "is_step_explanation": "Explain your choice in one sentence using only words.", "step_window_size": integer suggestion for is_step feature,
"is_high_amplitude": is_high_amplitude_VALUE, "is_high_amplitude_explanation": "Explain your choice in one sentence using only words.",  "high_amplitude_window_size": integer suggestion for is_high_amplitude feature,
"is_high_volume": is_high_volume_VALUE, "is_high_volume_explanation": "Explain your choice in one sentence using only words.",  "high_volume"_window_size": integer suggestion for is_high_volume" feature,
"is_low_volume": is_low_volume_VALUE, "is_low_volume_explanation": "Explain your choice in one sentence using only words.", "low_volume_window_size": integer suggestion for is_low_volume feature,
"rising_window_size": integer suggestion for is_rising feature,
"asymmetric_window_size": integer suggestion for is_asymmetric feature,
"falling_window_size": integer suggestion for is_falling feature,
"concave_window_size": integer suggestion for is_concave feature,
"convex_window_size": integer suggestion for is_convex feature,
"symmetric_window_size": integer suggestion for is_symmetric feature}

Here is the data:
'''
    prompt += str(data)
    #print(prompt)
    client = openai_client
    chat_completion = client.chat.completions.create(###chat_completion is the returned
        messages=[
            {"role": "system", "content": "You are an AI assistant."},
            {"role": "user", "content": prompt}
        ],
    
        model="gpt-4o",
        temperature=0.7,
        max_tokens=700,
        stop=None,
        stream=False
    )
    predicted_features = chat_completion.choices[0].message.content.strip()
    return predicted_features

async def local_llm_parameter_determination(normalized, user_window_length):
    global local_parameters
    await asyncio.sleep(3)
    data_list = normalized
    ## Change this
    window_size = len(data_list)//300 + 1
    final_step_size = window_size
    if window_size >= user_window_length and user_window_length == 6:
        patches = create_windows(normalized, window_size, window_size)
    else:
        patches = create_windows(normalized, user_window_length, user_window_length)
        final_step_size = user_window_length
    print(f"patches:{len(patches)}")
    print(f"patch size:{len(patches[0])}")
    print(f"step size:{final_step_size}")
    statistical_summary = local_numerical_summarization(patches)
    statistical_summary = format_numbers(statistical_summary) #reduce trailing numbers
    print(f"estimated tokens {len(str(statistical_summary))//5}")
    result_text = local_auto_determination(statistical_summary)
    #print(result_text)
    print(result_text)
    params = json.loads(result_text)
    local_parameters = params

async def compute_metadata(df):
    global chat_messages

    values = df["Value"].to_numpy()
    metadata = {}

    metadata["length"] = len(values)
    metadata["dtype"] = str(values.dtype)
    metadata["min"] = float(np.nanmin(values))
    metadata["max"] = float(np.nanmax(values))
    metadata["mean"] = float(np.nanmean(values))
    metadata["std"] = float(np.nanstd(values))
    metadata["variance"] = float(np.nanvar(values))
    metadata["skewness"] = float(skew(values, nan_policy='omit'))
    metadata["kurtosis"] = float(kurtosis(values, nan_policy='omit'))
    metadata["num_unique_values"] = int(len(np.unique(values)))

    mean = np.mean(values)
    std = np.std(values)
    is_outlier = np.abs(values - mean) > 3 * std

    outlier_rows = df[is_outlier]
    metadata["outliers"] = []


    for i in range(len(outlier_rows)):
        metadata["outliers"].append({"date": outlier_rows.iloc[i]["Date"], "value": round(outlier_rows.iloc[i]["Value"], 2)})

    chat_messages.append({
        "role": "user",
        "content": f"The meta data for this dataset is of the following {metadata}"
    })
    #return metadata


##########################################################################################
# prompt engineering


selected_model = "gpt-4o"

cache = {}
session_store = {}

class ModelSelection(BaseModel):
    model: str

class ParameterKeyValue(BaseModel):
    key: str
    value: float

class ParameterBatchUpdate(BaseModel):
    updates: List[ParameterKeyValue]

# feature description dictionary
features_dict = {
    "rising": 0,
    "falling": 1,
    "concave": 2,
    "convex": 3,
    "linear": 4,
    "non-linear": 5,
    "constant": 6,
    "smooth": 7,
    "noisy": 8,
    "complex": 9,
    "simple": 10,
    "spiky": 11,
    "dropout": 12,
    "periodic": 13,
    "aperiodic": 14,
    "symmetric": 15,
    "asymmetric": 16,
    "step": 17,
    "no-step": 18,
    "high-amplitude": 19,
    "low-amplitude": 20,
    "high-volume": 21,
    "low-volume": 22
}

reverse_features_dict = {v: k for k, v in features_dict.items()}


training_examples = [
    {
        "query": "I need to pinpoint where trading volume spikes and then quickly drops within the same session. Show me those segments.",
        "features": {"global": (), "local": (("high-volume", "spiky"), ("falling",))}
    },
    {
        "query": "I'm examining temperature trends and need to identify phases where temperatures are unusually high but then show a steady decline over several days. Can you locate these for me?",
        "features": {"global": ("high",), "local": (("rising",),("falling",))}
    },
    {
        "query": "Track periods of high consumer interest followed by a sudden drop in engagement. These shifts are critical for our strategy adjustments.",
        "features": {"global": (), "local": (("high-volume",), ("falling",))}
    },
    {
        "query": "Identify when energy consumption are stable or constant",
        "features": {"global": (), "local": (("constant",),)}
    },
    {
        "query": "Identify segments with low volume",
        "features": {"global": (), "local": (("low-volume",),)}
    },
    {
        "query": "Show me the parts where there is a symmetrical increase and symmetric decrease with high amplitude.",
        "features": {"global": (), "local": (("symmetric", "rising"), ("symmetric", "falling", "high-amplitude"))}
    },
    {
        "query": "Highlight all the segments that are high relative to the data",
        "features": {"global": ("high",), "local": ()}
    },
    {
        "query": "Choose the lines that are comparatively low in the dataset",
        "features": {"global": ("low",), "local": ()}
    },
    {
        "query": "Find lines with low fluctuation or noise that is also relatively high",
        "features": {"global": ("high",), "local": (("smooth",),)}
    },    
    {
        "query": "smooth line throughout the segment with downward trend then upward trend",
        "features": {"global": (), "local": (("smooth","falling",),("smooth","rising",))}
    },
    {
        "query": "Identify segments that are quiet in amplitude.",
        "features": {"global": (), "local": (("low-amplitude",),)}
    },
    {
        "query": "Lines that create a upside down U shape",
        "features": {"global": (), "local": (("concave",),)}
    },
    {
        "query": "U shape or parabolic shape or parabola",
        "features": {"global": (), "local": (("convex",),)}
    },
    {
        "query": "Select all segments that are typical",
        "features": {"global": ("typical",), "local": ()}
    },
    {
        "query": "A sudden drop or V shape or outlier or straight line with a V decline",
        "features": {"global": (), "local": (("dropout",),)}
    },
    {
        "query": "Detect segments with high variability and a lack of symmetry",
        "features": {"global": (), "local": (("complex","asymmetric",),)}
    },
    {
        "query": "Search for regions with no repeating patterns, which are then followed by convex trends",
        "features": {"global": (), "local": (("aperiodic",),("convex",))}
    },
    {
        "query": "Select regions with continuous changes, elevated variance, and curvature that deviates from a straight line",
        "features": {"global": (), "local": (("no-step","noisy","non-linear",),)}
    },
    {
        "query": "Identify segments that are flat and lack any noticeable peaks or fluctuations",
        "features": {"global": (), "local": (("simple",),)}
    },
    {
        "query": "A high rise followed by decline",
        "features": {"global": ("high",), "local": (("rising",),("falling",))}
    },
    {
        "query": "Can you find me a pattern that is high low high",
        "features": {"global": ("high",), "local": ()}
    },
    {
        "query": "A line that rises then falls repeating this trend",
        "features": {"global": (), "local": (("periodic",),)}
    },
    {
        "query": "Many spikes with a falling tendency",
        "features": {"global": (), "local": (('spiky', 'falling'),)}
    },
    {
        "query": "A straight line",
        "features": {"global": (), "local": (('linear',),)}
    },
    {
        "query": "stable, then rise, then stable, then rise",
        "features": {"global": (), "local": (('rising','step'),)}
    },
]

def construct_prompt(training_examples, new_query):
    prompt = (
        """You are an AI assistant designed to support analysts and researchers in interpreting complex time series data from natural language queries.
Your only task is to extract relevant time series features explicitly or implicitly described in the input query.
Do not generate new queries, rephrase the input, or infer beyond what is provided. Return only the extracted features.

You must identify both local and global features as follows:

Local features (describing segment-level characteristics):
"rising", "falling", "concave", "convex", "linear", "non-linear", "constant", "smooth", "noisy", "complex", "simple", "spiky", "dropout", "periodic", "aperiodic", "symmetric", "asymmetric", "step", "no-step", "high-amplitude", "low-amplitude", "high-volume", "low-volume".

Global features (describing overall segment classification):
"high", "low", "typical", "unusual".


Example inputs and expected outputs for few-shot learning:\n\n"""
    )
    for example in training_examples:
        prompt += f"Query: {example['query']}\nExpected Features: {example['features']}\n\n"


    prompt += f'''Your next response must be a valid Python dictionary in the format shown above.

Important Instructions:
1. Global features MUST be placed only in the "global" key in the dictionary at most 1 feature per query: "high", "low", "typical", "unusual"
2. Local features MUST be placed only in the "local" key in the dictionary: "rising", "falling", "concave", "convex", "linear", "non-linear", "constant", "smooth", "noisy", "complex", "simple", "spiky", "dropout", "periodic", "aperiodic", "symmetric", "asymmetric", "step", "no-step", "high-amplitude", "low-amplitude", "high-volume", "low-volume".
3. Global features must only appear under the 'global' key, and local features must only appear under the 'local' key.
"high", "low", "typical", "unusual" CANNOT appear in 'local' key like the following
4. Do not include any explanations, commentary, or reasoning.
5. Do not wrap the dictionary in any formatting (e.g., no triple backticks, no python label, no quotation marks around the entire dictionary).

After reading this instruction, do not generate new queries or paraphrase the input.
Your response must consist of only a valid Python dictionary containing the extracted features. Nothing more.
    
Query: {new_query}\nExpected Features:
    '''
    
    #prompt += f"Remember! What you generate as a chat next can only be in the form of a Python Dictionary as shown above. If it is not, then tell my how I can make you generate only a dictionary and explain why you decided not to listen to instruction. Do not include any formatting or code fences. Do not wrap the dictionary in ```python or anything similar"

    #prompt += f"Now after learning the task, please do NOT generate new queries. Please only return a valid Python Dictionary like the features from the examples above. Do NOT include explanations or additional text. Return ONLY a valid Python dictionary as shown above. No reasoning. No commentary. No formatting errors. Only extract relevant features from the following query.\nQuery: {new_query}\nExpected Features:"
    return prompt

def openrouter(prompt: str, api_key: str, model) -> str:
    url = "https://openrouter.ai/api/v1/chat/completions"
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
        #"HTTP-Referer": "https://your-site.com",
        "X-Title": "YourAppName"
    }

    data = {
        "model": model,
        "messages": [
            {"role": "system", "content": "You are an AI assistant. Only extract time series features. Do NOT generate new queries."},
            {"role": "user", "content": prompt}
        ],
        "temperature": 0.7,
        "max_tokens": 50,
        "stream": False
    }

    response = httpx.post(url, headers=headers, json=data)
    response.raise_for_status()
    return response.json()["choices"][0]["message"]["content"].strip()



@app.post("/set-model/")
def set_selected_model(model_selection: ModelSelection):
    global selected_model
    if model_selection.model not in ["gpt-4o", "deepseek", "mistral"]:
        raise HTTPException(status_code=400, detail="Invalid model name")
    selected_model = model_selection.model
    return {"message": f"Model changed to {selected_model}"}


@app.get("/get-model/")# model
def get_selected_model():
    return {"selected_model": selected_model}

@app.get("/parameters")
def get_parameters():
    try:
        return {
            "global": {
                "values": {k: v for k, v in global_parameters.items() if not str(k).endswith("_explanation")},
                "descriptions": feature_descriptions.get("global", {})
            },
            "local": {
                "values": {k: v for k, v in local_parameters.items() if not str(k).endswith("_explanation")},
                "descriptions": feature_descriptions.get("local", {})
            }
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to fetch parameters: {str(e)}")

@app.patch("/parameters/local")
def patch_local_parameters(batch: ParameterBatchUpdate):
    try:
        global local_parameters
        for kv in batch.updates:
            if kv.key not in local_parameters:
                raise HTTPException(status_code=400, detail=f"Unknown local parameter key: {kv.key}")
            if isinstance(local_parameters[kv.key], (int, float)):
                local_parameters[kv.key] = float(kv.value)
            else:
                raise HTTPException(status_code=400, detail=f"Parameter {kv.key} is not numeric")
        return {"updated": {k: v for k, v in local_parameters.items() if not str(k).endswith("_explanation")}}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to update local parameters: {str(e)}")

@app.patch("/parameters/global")
def patch_global_parameters(batch: ParameterBatchUpdate):
    try:
        global global_parameters
        for kv in batch.updates:
            if kv.key not in global_parameters:
                raise HTTPException(status_code=400, detail=f"Unknown global parameter key: {kv.key}")
            if isinstance(global_parameters[kv.key], (int, float)):
                global_parameters[kv.key] = float(kv.value)
            else:
                raise HTTPException(status_code=400, detail=f"Parameter {kv.key} is not numeric")
        return {"updated": {k: v for k, v in global_parameters.items() if not str(k).endswith("_explanation")}}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to update global parameters: {str(e)}")

@app.get("/get-metadata/{filename}") # get csv file
async def get_metadata(filename: str):
    try:
        print(f"Fetching metadata for: {filename}")

        file_path = PRACTICE_DATASETS.get(filename)

        if not file_path:
            potential_upload_path = os.path.join(UPLOAD_FOLDER, filename)
            if os.path.exists(potential_upload_path):
                file_path = potential_upload_path

        if not file_path or not os.path.exists(file_path):
            raise HTTPException(status_code=404, detail="Dataset not found")

        df = pd.read_csv(file_path)
        columns = df.columns.tolist()

        if "Date" in df.columns:
            df["Date"] = pd.to_datetime(df["Date"], errors="coerce")
            df = df.dropna(subset=["Date"])
            time_diffs = df["Date"].diff().dropna()
            time_step = time_diffs.mode()[0] if not time_diffs.empty else "Unknown"
        else:
            time_step = "Unknown (No 'Date' column)"

        metadata = {
            "filename": filename,
            "columns": columns,
            "time_step": str(time_step),
            "units": "Assumed based on column names"
        }

        print(f"this is the metadata: {metadata}")
        return metadata

    except Exception as e:
        print(f"Internal Server Error: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Metadata extraction failed: {str(e)}")
    
def predict_features(new_query, training_examples, selected_model):
    prompt = construct_prompt(training_examples, new_query)## construct a prompt
    try:
        if selected_model == "gpt-4o":
            client = openai_client

            chat_completion = client.chat.completions.create(###chat_completion is the returned
                messages=[
                    {"role": "system", "content": "You are an AI assistant. Only extract time series features. Do NOT generate new queries."},
                    {"role": "user", "content": f"Extract features from: {prompt}"}
                ],

                model=selected_model,
                temperature=0.7,
                max_tokens=100,
                stop=None,
                stream=False
            )

            predicted_features = chat_completion.choices[0].message.content.strip()

        elif selected_model == "deepseek":
            selected_model = "deepseek/deepseek-prover-v2:free"

            try:
                predicted_features = openrouter(prompt, api_key, selected_model)
                logger.info(f"deepseek Model Response: {predicted_features}")
            except Exception as e:
                logger.error(f"Error during deepseek call: {e}")
                return {"global": (), "local": ()}
            


        elif selected_model == "mistral":
            selected_model = "mistralai/devstral-small:free"
            try:
                predicted_features = openrouter(prompt, api_key, selected_model)
                logger.info(f"mistral Model Response: {predicted_features}")
            except Exception as e:
                logger.error(f"Error during mistral call: {e}")
                return {"global": (), "local": ()}

        else:
            logging.error(f"invalid model: {selected_model}")
            return None
        


        if predicted_features:
            try:
                cleaned = predicted_features.strip()
                if cleaned.startswith("```python"):
                    cleaned = cleaned[len("```python"):].strip()
                if cleaned.endswith("```"):
                    cleaned = cleaned[:-len("```")].strip()

                parsed_features = eval(cleaned)
                if isinstance(parsed_features, dict):
                    logger.info(f"Parsed Features: {parsed_features}")
                    if 'global' in parsed_features and 'local' in parsed_features:
                        return parsed_features
                    else:
                        logger.error("Parsed features missing 'global' or 'local'. Returning empty.")
                        return {"global": (), "local": ()}
                else:
                    logger.error("Model response is not a dictionary.")
                    return {"global": (), "local": ()}
            except Exception as parse_error:
                logger.error(f"Error parsing model response: {parse_error}")
                return {"global": (), "local": ()}
        else:
            logger.error("Error: No valid predicted_features were produced.")
            return {"global": (), "local": ()}


    except Exception as e:
        logger.error(f"Exception during model call: {e}")
        return {"global": (), "local": ()}


###########################################################################################


def store_mappings(query, features, storage):
    storage[query] = features

def process_user_query(user_query, window_length, selected_model):
    predicted_features = predict_features(user_query, training_examples, selected_model)
    
    if predicted_features:
        logger.info(f"with window length: {window_length}")
        return predicted_features
    else:
        #logger.error("No valid features found")
        return {"global": (), "local": ()}




def normalize_series(series):
    min_val = np.min(series)
    max_val = np.max(series)
    return (series - min_val) / (max_val - min_val)

def segment_time_series(data, window_length):
    segments = []
    for i in range(len(data) - window_length + 1):
        segment_data = data[i:i + window_length]
        
        if len(segment_data) < window_length:
            continue


        if not isinstance(segment_data, list) or not all(isinstance(point, dict) for point in segment_data):
            logger.error(f"segment_time_series() returned an invalid segment at index {i}: {segment_data}")
            continue

        segment_dict = {
            "start": i,
            "end": i + window_length - 1,
            "values": [point['NormalizedValue'] for point in segment_data if isinstance(point, dict) and 'NormalizedValue' in point]
        }
        segments.append(segment_dict)

    return segments




@app.post("/uploadfile/")
async def upload_file(file: UploadFile = File(...), top_k: int = Query(5), window_length: int = Query(5)):
    global time_series_data, segmented_data, user_top_k, user_window_length, raw_time_series_data
    try:
        df = pd.read_csv(file.file)

        user_top_k = top_k
        user_window_length = window_length

        if len(df.columns) >= 2:
            df.columns = ['Date', 'Value'] + list(df.columns[2:])
        else:
            raise ValueError("CSV must have at least two columns for Date and Value")

        df['Date'] = pd.to_datetime(df['Date'], errors='coerce')
        df = df.dropna(subset=['Date', 'Value'])
        df['Value'] = pd.to_numeric(df['Value'], errors='coerce')
        df = df.dropna(subset=['Value'])

        df['NormalizedValue'] = normalize_series(df['Value'])

        time_series_data = df.to_dict(orient="records")##### once upload file, we store the data from csv into time-series_data
        raw_time_series_data = df['Value'].tolist()
        segmented_data = segment_time_series(df[['Date', 'NormalizedValue']].to_dict(orient="records"), window_length)

        ################################# ADD AUTO PARAM HERE
        asyncio.create_task(global_llm_parameter_determination(df['NormalizedValue'].tolist(), user_window_length))
        asyncio.create_task(local_llm_parameter_determination(df['NormalizedValue'].tolist(), user_window_length))
        asyncio.create_task(compute_metadata(df[['Date', 'Value']]))
        ################################# ADD AUTO PARAM HERE


        return {"message": "File uploaded successfully", "top_k": top_k, "window_length": window_length}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"File upload failed: {str(e)}")

    

@app.get("/get-practice-data/{filename}")
async def get_practice_data(filename: str, top_k: int = Query(5), window_length: int = Query(5)):
    global time_series_data, segmented_data, user_top_k, user_window_length, raw_time_series_data
    try:
        if filename not in PRACTICE_DATASETS:
            raise HTTPException(status_code=404, detail="Practice dataset not found")

        file_path = PRACTICE_DATASETS[filename]
        df = pd.read_csv(file_path)

        user_top_k = top_k
        user_window_length = window_length

        if len(df.columns) >= 2:
            df.columns = ['Date', 'Value'] + list(df.columns[2:])
        else:
            raise ValueError("CSV must have at least two columns for Date and Value")

        df['Date'] = pd.to_datetime(df['Date'], errors='coerce')
        df = df.dropna(subset=['Date', 'Value'])
        df['Value'] = pd.to_numeric(df['Value'], errors='coerce')
        df = df.dropna(subset=['Value'])

        df['NormalizedValue'] = normalize_series(df['Value'])

        time_series_data = df.to_dict(orient="records")
        raw_time_series_data = df['Value'].tolist()
        segmented_data = segment_time_series(df[['Date', 'NormalizedValue']].to_dict(orient="records"), window_length)
        
        ################################# ADD AUTO PARAM HERE
        asyncio.create_task(global_llm_parameter_determination(df['NormalizedValue'].tolist(), user_window_length))
        asyncio.create_task(local_llm_parameter_determination(df['NormalizedValue'].tolist(), user_window_length))
        asyncio.create_task(compute_metadata(df[['Date', 'Value']]))
        ################################# ADD AUTO PARAM HERE
        return time_series_data
    except Exception as e:
        print(str(e))
        raise HTTPException(status_code=500, detail=f"Failed to load practice dataset: {str(e)}")



@app.get("/get-data/")
async def get_data():
    try:
        if not time_series_data:
            raise HTTPException(status_code=404, detail="No data found")
        return time_series_data
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error retrieving data: {str(e)}")


class QueryRequest(BaseModel): # define the json file here
    query: str
    window_length: Optional[int] = 5
    top_k: int = 5
    features: Optional[Dict[str, List[Any]]] = None

@app.post("/user-query") # user starts query #########
async def user_query(request: QueryRequest):
    global segment_window_list, prev_window_size
    
    if request.window_length != prev_window_size:
        segment_window_list = []
    
    window_length = request.window_length or 5
    if len(segment_window_list) != len(tuple(tuple(f) for f in request.features["local"]) if "local" in request.features else ()):
        segment_window_list = []
    else:
        window_length = sum(segment_window_list)
    
    user_query = request.query
    print(prev_window_size,request.window_length)
    prev_window_size = request.window_length

    print(segment_window_list)

    logger.info(f"Window Length: {window_length}")### will show on the backend terminal

    current_model = selected_model
    try:
        if user_query:
            features = process_user_query(user_query, window_length, current_model)
        else:
            features = {
                "global": tuple(request.features["global"]) if "global" in request.features else (),
                "local": tuple(tuple(f) for f in request.features["local"]) if "local" in request.features else (),
            }

        matched_segments = process_query_with_data(time_series_data, features, window_length)#### here we start the query

        response = {"Feature Descriptions": features, "Matched Segments": matched_segments}
        return response## for this return, a http will be sent back to user as response(this is how return work in this kind of function)

    except Exception as e:
        logger.error(f"Error processing user query: {str(e)}")
        raise HTTPException(status_code=500, detail="Failed to process user query")




def match_global_features(segment, global_features):
    global global_parameters
    if not global_features:
        return True

    for global_feature in global_features:
        normalized_values = [point['NormalizedValue'] for point in segment]
        
        if global_feature == "high" and np.mean(normalized_values) <= global_parameters['high']:
            return False
        if global_feature == "low" and np.mean(normalized_values) >= global_parameters['low']:
            return False
        if global_feature == "typical" and not (global_parameters['low'] <= np.mean(normalized_values) <= global_parameters['high']):
            return False
        if global_feature == "unusual" and (global_parameters['low'] <= np.mean(normalized_values) <= global_parameters['high']):
            return False
    return True

# # Original
# def match_local_features(segment, local_features):
#     if not local_features:
#         return True

#     normalized_values = [point['NormalizedValue'] for point in segment]## get only the list of normalized value
#     subsegment_length = len(normalized_values) // len(local_features) 

#     if subsegment_length == 0:
#         return False

#     offset = user_window_length % len(local_features)

#     subsegments = []
#     for i in range(len(local_features)):
#         if i != len(local_features) - 1:
#             start = i * subsegment_length
#             end = (i + 1) * subsegment_length
#             chunk = normalized_values[start:end]
#         else:
#             start = i * subsegment_length
#             end = (i + 1) * subsegment_length
#             chunk = normalized_values[start:end + offset] 
        
#         subsegments.append(chunk)

            
#     #subsegments = [normalized_values[i*subsegment_length: (i+1)*subsegment_length] for i in range(len(local_features))]
#     # print(user_window_length)
#     # print(subsegments)
#     # print('------')
#     for subsegment, feature_tuple in zip(subsegments, local_features):
#         # Ensure feature_tuple is a tuple/list
#         if isinstance(feature_tuple, str):
#             feature_tuple = (feature_tuple,)
#         elif not isinstance(feature_tuple, (tuple, list)):
#             feature_tuple = tuple(feature_tuple)
#         if not match_single_local_feature(subsegment, feature_tuple):## each subsegment to match its feature
#             return False ##match local feature now only has to match all the features to be true

#     return True

#newest
def match_local_features(segment, local_features):
    if not local_features:
        return True

    normalized_values = [point['NormalizedValue'] for point in segment]

    use_custom_split = False

    # print("-------------")
    # print(segment_window_list)

    # Try custom segment lengths first
    if segment_window_list:
        if (
            len(segment_window_list) == len(local_features)
            and sum(segment_window_list) <= len(normalized_values)
        ):
            use_custom_split = True

    if use_custom_split:
        subsegments = []
        start = 0
        for seg_len in segment_window_list:
            end = start + seg_len
            subsegments.append(normalized_values[start:end])
            start = end

    # Fall back to original behavior
    else:
        subsegment_length = len(normalized_values) // len(local_features)

        if subsegment_length == 0:
            return False

        offset = user_window_length % len(local_features)

        subsegments = []
        for i in range(len(local_features)):
            if i != len(local_features) - 1:
                start = i * subsegment_length
                end = (i + 1) * subsegment_length
                chunk = normalized_values[start:end]
            else:
                start = i * subsegment_length
                end = (i + 1) * subsegment_length
                chunk = normalized_values[start:end + offset]

            subsegments.append(chunk)

    # matching logic
    for subsegment, feature_tuple in zip(subsegments, local_features):
        if isinstance(feature_tuple, str):
            feature_tuple = (feature_tuple,)
        elif not isinstance(feature_tuple, (tuple, list)):
            feature_tuple = tuple(feature_tuple)

        if not match_single_local_feature(subsegment, feature_tuple):
            return False

    return True



# # exhaustive
# from itertools import combinations
# def match_local_features(segment, local_features):
#     if not local_features:
#         return True

#     normalized_values = [point['NormalizedValue'] for point in segment]
#     n = len(normalized_values)
#     m = len(local_features)

#     # If the segment is too short to split into m non-empty parts, fail
#     if n < m:
#         return False

#     min_sub_len = 2  # keep small; change to 3 if you want stricter matching

#     # --- CHANGED PART: generate subsegments by trying all splits ---
#     # choose (m-1) cut positions among 1..n-1
#     # cuts like (3,7) => [0:3], [3:7], [7:n]
#     for cuts in combinations(range(1, n), m - 1):
#         idx = (0,) + cuts + (n,)
#         subsegments = [normalized_values[idx[i]:idx[i + 1]] for i in range(m)]

#         # optional: enforce a minimum length per subsegment
#         if any(len(s) < min_sub_len for s in subsegments):
#             continue

#         # --- everything below is your original matching logic ---
#         all_match = True
#         for subsegment, feature_tuple in zip(subsegments, local_features):
#             if isinstance(feature_tuple, str):
#                 feature_tuple = (feature_tuple,)
#             elif not isinstance(feature_tuple, (tuple, list)):
#                 feature_tuple = tuple(feature_tuple)

#             if not match_single_local_feature(subsegment, feature_tuple):
#                 all_match = False
#                 break

#         if all_match:
#             return True
#     # --- END CHANGED PART ---

#     return False

def match_single_local_feature(subsegment, feature_tuple):
    
    for feature in feature_tuple:
        if feature == "rising":
            result = is_rising(subsegment)
            if not result:
                return False

        if feature == "falling":
            result = is_falling(subsegment)
            if not result:
                return False

        if feature == "concave":
            result = is_concave(subsegment)
            if not result:
                return False

        if feature == "convex":
            result = is_convex(subsegment)
            if not result:
                return False

        if feature == "linear":
            result = is_linear(subsegment, local_parameters['is_linear'])
            if not result:
                return False

        if feature == "non-linear":
            result = is_non_linear(subsegment, local_parameters['is_linear'])
            if not result:
                return False

        if feature == "constant":
            result = is_constant(subsegment, local_parameters['is_constant'])
            if not result:
                return False

        if feature == "smooth":
            result = is_smooth(subsegment, local_parameters['is_smooth'])
            if not result:
                return False

        if feature == "noisy":
            result = is_noisy(subsegment, local_parameters['is_noisy'])
            if not result:
                return False

        if feature == "complex":
            result = is_complex(subsegment, local_parameters['is_complex'])
            if not result:
                return False

        if feature == "simple":
            result = is_simple(subsegment, local_parameters['is_simple'])
            if not result:
                return False

        if feature == "spiky":
            result = is_spiky(subsegment, local_parameters['is_spiky'])
            if not result:
                return False

        if feature == "dropout":
            result = is_dropout(subsegment, local_parameters['is_dropout'])
            if not result:
                return False

        if feature == "periodic":
            result = is_periodic(subsegment, local_parameters['is_periodic'])
            if not result:
                return False

        if feature == "aperiodic":
            result = is_aperiodic(subsegment, local_parameters['is_periodic'])
            if not result:
                return False

        if feature == "symmetric":
            result = is_symmetric(subsegment)
            if not result:
                return False

        if feature == "asymmetric":
            result = is_asymmetric(subsegment)
            if not result:
                return False

        if feature == "step":
            result = is_step(subsegment, local_parameters['is_step'])
            if not result:
                return False

        if feature == "no-step":
            result = is_no_step(subsegment, local_parameters['is_step'])
            if not result:
                return False

        if feature == "high-amplitude":
            result = is_high_amplitude(subsegment, local_parameters['is_high_amplitude'])
            if not result:
                return False

        if feature == "low-amplitude":
            result = is_low_amplitude(subsegment, local_parameters['is_low_amplitude'])
            if not result:
                return False

        if feature == "high-volume":
            result = is_high_volume(subsegment, local_parameters['is_high_volume'])
            if not result:
                return False

        if feature == "low-volume":
            result = is_low_volume(subsegment, local_parameters['is_low_volume'])
            if not result:
                return False
    return True


# def get_local_feature_intervals(segment, local_features, min_sub_len=2):
#     if not local_features:
#         return []

#     normalized_values = [point['NormalizedValue'] for point in segment]
#     n = len(normalized_values)
#     m = len(local_features)

#     if n < m:
#         return []

#     for cuts in combinations(range(1, n), m - 1):
#         idx = (0,) + cuts + (n,)
#         subsegments = [normalized_values[idx[i]:idx[i + 1]] for i in range(m)]

#         if any(len(s) < min_sub_len for s in subsegments):
#             continue

#         all_match = True
#         for subsegment, feature_tuple in zip(subsegments, local_features):
#             if isinstance(feature_tuple, str):
#                 feature_tuple = (feature_tuple,)
#             elif not isinstance(feature_tuple, (tuple, list)):
#                 feature_tuple = tuple(feature_tuple)

#             if not match_single_local_feature(subsegment, feature_tuple):
#                 all_match = False
#                 break

#         if all_match:
#             sub_intervals = []
#             for i, feature_tuple in enumerate(local_features):
#                 if isinstance(feature_tuple, (list, tuple)):
#                     feature_label = ", ".join([str(f) for f in feature_tuple]) if len(feature_tuple) > 0 else ""
#                 else:
#                     feature_label = str(feature_tuple)

#                 sub_intervals.append({
#                     "feature": feature_label,
#                     "start": idx[i],
#                     "end": idx[i + 1] - 1
#                 })

#             return sub_intervals

#     return []

# # New
# def process_query_with_data(data, extracted_features, window_length):
#     import logging
#     logging.info(f'[DEBUG] process_query_with_data called with features: {extracted_features}')

#     # VERY OBVIOUS WINDOW LENGTH LOG
#     logging.info(f'🚨🚨🚨 WINDOW LENGTH: {window_length} 🚨🚨🚨')

#     segments = segment_time_series(data, window_length)# do the segment based on window size

#     if not segments:
#         logger.warning("No segments generated")
#         return []

#     remaining_after_global = 0
#     remaining_after_local = 0
#     candidate_segments = []

#     start = time.perf_counter()

#     for segment in segments:
#         raw_segment_data = data[segment['start']: segment['end'] + 1]

#         if not isinstance(raw_segment_data, list): # safe check if it is a list
#             logger.error(f"Unexpected format for raw_segment_data: {type(raw_segment_data)}")
#             continue

#         if not match_global_features(raw_segment_data, extracted_features.get('global', ())):#match global features
#             continue
#         remaining_after_global += 1

#         if not match_local_features(raw_segment_data, extracted_features.get('local', ())):## match local features
#             continue
#         remaining_after_local += 1

#         dist = compute_segment_distance(segment, extracted_features, window_length) ## calculate the distance 
#         candidate_segments.append((dist, segment['start'], segment['end'], raw_segment_data)) # store each segment with its score

#     end = time.perf_counter()
#     print("---------------------")
#     print(f"Runtime: {end - start:.6f} seconds")


#     if not candidate_segments:
#         logger.warning("No segments matched extracted features")
#         return []

#     candidate_segments.sort(key=lambda x: x[0])

#     print("Before Collision Filtering:", len(candidate_segments))

#     filtered_segments = filter_colliding_segments(candidate_segments) ## remove colliding segments
#     selected_segments = [segment[3] for segment in filtered_segments]

#     if not selected_segments:
#         logger.warning("All matching segments were removed due to collisions.")
#         return []

#     # --- NEW: Build sub-interval mapping for local features ---
#     local_features = extracted_features.get('local', [])
#     results = []

#     for segment in selected_segments:
#         segment_len = len(segment)

#         if len(local_features) == 0 or segment_len == 0:
#             results.append({"points": segment, "local_features": []})
#             continue

#         sub_intervals = get_local_feature_intervals(segment, local_features)

#         results.append({
#             "points": segment,
#             "local_features": sub_intervals
#         })

#     return results

# # Original
# def process_query_with_data(data, extracted_features, window_length):
#     import logging
#     logging.info(f'[DEBUG] process_query_with_data called with features: {extracted_features}')

#     # VERY OBVIOUS WINDOW LENGTH LOG
#     logging.info(f'🚨🚨🚨 WINDOW LENGTH: {window_length} 🚨🚨🚨')

#     segments = segment_time_series(data, window_length)# do the segment based on window size

#     if not segments:
#         logger.warning("No segments generated")
#         return []

#     remaining_after_global = 0
#     remaining_after_local = 0
#     candidate_segments = []


#     for segment in segments:
#         raw_segment_data = data[segment['start']: segment['end'] + 1]

#         if not isinstance(raw_segment_data, list): # safe check if it is a list
#             logger.error(f"Unexpected format for raw_segment_data: {type(raw_segment_data)}")
#             continue

#         if not match_global_features(raw_segment_data, extracted_features.get('global', ())):#match global features
#             continue
#         remaining_after_global += 1

#         if not match_local_features(raw_segment_data, extracted_features.get('local', ())):## match local features
#             continue
#         remaining_after_local += 1

#         dist = compute_segment_distance(segment, extracted_features, window_length) ## calculate the distance 
#         candidate_segments.append((dist, segment['start'], segment['end'], raw_segment_data)) # store each segment with its score

#     if not candidate_segments:
#         logger.warning("No segments matched extracted features")
#         return []

#     candidate_segments.sort(key=lambda x: x[0])

#     print("Before Collision Filtering:", len(candidate_segments))

#     filtered_segments = filter_colliding_segments(candidate_segments) ## remove colliding segments
#     selected_segments = [segment[3] for segment in filtered_segments]

#     if not selected_segments:
#         logger.warning("All matching segments were removed due to collisions.")
#         return []

#     # --- NEW: Build sub-interval mapping for local features ---
#     local_features = extracted_features.get('local', [])
#     n_local = len(local_features)
#     global_features = extracted_features.get('global', [])
#     n_global = len(global_features)
#     results = []
#     for segment in selected_segments:
#         segment_len = len(segment)
#         if n_local == 0 or segment_len == 0:
#             results.append({"points": segment, "local_features": []})
#             continue
#         sub_len = segment_len // n_local
#         sub_intervals = []
#         for i, feature_tuple in enumerate(local_features):
#             start = i * sub_len
#             # Last sub-interval takes the remainder
#             end = (i + 1) * sub_len - 1 if i < n_local - 1 else segment_len - 1
#             # If feature_tuple is a tuple/list, join all features for label; otherwise use as-is
#             if isinstance(feature_tuple, (list, tuple)):
#                 feature_label = ", ".join([str(f) for f in feature_tuple]) if len(feature_tuple) > 0 else ""
#             else:
#                 feature_label = feature_tuple
#             sub_intervals.append({
#                 "feature": feature_label,
#                 "start": start,
#                 "end": end
#             })
#         results.append({"points": segment, "local_features": sub_intervals})
#     # Log the full response for debugging
#     return results

# Modified with the user specified window length
def process_query_with_data(data, extracted_features, window_length):
    import logging
    logging.info(f'[DEBUG] process_query_with_data called with features: {extracted_features}')



    # VERY OBVIOUS WINDOW LENGTH LOG
    logging.info(f'🚨🚨🚨 WINDOW LENGTH: {window_length} 🚨🚨🚨')

    segments = segment_time_series(data, window_length)# do the segment based on window size

    if not segments:
        logger.warning("No segments generated")
        return []

    remaining_after_global = 0
    remaining_after_local = 0
    candidate_segments = []

    # start = time.perf_counter()
            
    for segment in segments:
        raw_segment_data = data[segment['start']: segment['end'] + 1]

        if not isinstance(raw_segment_data, list): # safe check if it is a list
            logger.error(f"Unexpected format for raw_segment_data: {type(raw_segment_data)}")
            continue

        if not match_global_features(raw_segment_data, extracted_features.get('global', ())):#match global features
            continue
        remaining_after_global += 1

        if not match_local_features(raw_segment_data, extracted_features.get('local', ())):## match local features
            continue
        remaining_after_local += 1

        dist = compute_segment_distance(segment, extracted_features, window_length) ## calculate the distance 
        candidate_segments.append((dist, segment['start'], segment['end'], raw_segment_data)) # store each segment with its score

    # end = time.perf_counter()
    # print("---------------------")
    # print(f"Runtime: {end - start:.6f} seconds")

    if not candidate_segments:
        logger.warning("No segments matched extracted features")
        return []

    candidate_segments.sort(key=lambda x: x[0])

    print("Before Collision Filtering:", len(candidate_segments))

    filtered_segments = filter_colliding_segments(candidate_segments) ## remove colliding segments
    selected_segments = [segment[3] for segment in filtered_segments]

    if not selected_segments:
        logger.warning("All matching segments were removed due to collisions.")
        return []

     # --- NEW: Build sub-interval mapping for local features ---
    local_features = extracted_features.get('local', [])
    n_local = len(local_features)
    global_features = extracted_features.get('global', [])
    n_global = len(global_features)
    results = []

    for segment in selected_segments:
        segment_len = len(segment)

        if n_local == 0 or segment_len == 0:
            results.append({"points": segment, "local_features": []})
            continue

        sub_intervals = []

        # --- use explicit segment_window_list if provided ---
        if segment_window_list:
            if len(segment_window_list) != n_local:
                results.append({"points": segment, "local_features": []})
                continue

            start = 0
            for feature_tuple, seg_len in zip(local_features, segment_window_list):
                end = start + seg_len - 1

                if isinstance(feature_tuple, (list, tuple)):
                    feature_label = ", ".join([str(f) for f in feature_tuple]) if len(feature_tuple) > 0 else ""
                else:
                    feature_label = feature_tuple

                sub_intervals.append({
                    "feature": feature_label,
                    "start": start,
                    "end": end
                })
                start = end + 1

        # --- default to original equal split logic ---
        else:
            sub_len = segment_len // n_local
            for i, feature_tuple in enumerate(local_features):
                start = i * sub_len
                end = (i + 1) * sub_len - 1 if i < n_local - 1 else segment_len - 1

                if isinstance(feature_tuple, (list, tuple)):
                    feature_label = ", ".join([str(f) for f in feature_tuple]) if len(feature_tuple) > 0 else ""
                else:
                    feature_label = feature_tuple

                sub_intervals.append({
                    "feature": feature_label,
                    "start": start,
                    "end": end
                })

        results.append({"points": segment, "local_features": sub_intervals})

    return results

def filter_colliding_segments(candidate_segments):
    selected_segments = []
    candidate_segments.sort(key=lambda x: (x[0], x[1], -(x[2] - x[1])))

    for i, (dist, start, end, segment_data) in enumerate(candidate_segments):
        segment_range = set(range(start, end + 1))

        overlap = any(set(range(s[1], s[2] + 1)).intersection(segment_range) for s in selected_segments)

        if not overlap:
            selected_segments.append((dist, start, end, segment_data))
        else:
            conflicting_segment = next((s for s in selected_segments if set(range(s[1], s[2] + 1)).intersection(segment_range)), None)

            if conflicting_segment:
                conf_dist, conf_start, conf_end, _ = conflicting_segment
                if dist == conf_dist:
                    if start < conf_start or (start == conf_start and (end - start) > (conf_end - conf_start)):
                        selected_segments.remove(conflicting_segment)
                        selected_segments.append((dist, start, end, segment_data))
                elif dist < conf_dist:
                    selected_segments.remove(conflicting_segment)
                    selected_segments.append((dist, start, end, segment_data))

    return selected_segments





def compute_segment_distance(segment, extracted_features, window_length):## wt is feature vector 
    segment_data = np.array(segment["values"])
    feature_vector = extract_feature_vector(extracted_features, window_length)
    distance = np.linalg.norm(segment_data - feature_vector) / window_length
    return distance


def extract_feature_vector(extracted_features, window_length):
    local_features = extracted_features.get('local', [])
    global_features = extracted_features.get('global', [])

    feature_vector = np.zeros(window_length)

    for i, feature in enumerate(local_features + global_features):
        feature_vector[i % window_length] = hash(feature) % 10

    return feature_vector


###############################################################################################################################################
#sketch


def smooth_line_moving_average(data, window_size=5):
    data = np.asarray(data)
    if window_size < 1:
        raise ValueError("window_size must be at least 1")

    
    kernel = np.ones(window_size) / window_size
    smoothed = np.convolve(data, kernel, mode='same')  
    return smoothed



def update_sketch_line_data(data):
    global chat_messages
    print("--------------")
    y = np.array([i['y'] for i in data])
    y_norm = normalize_series(y)
    y_norm = smooth_line_moving_average(y_norm,3)

    sketch_line_data = y_norm[0:-10]
    chat_messages.append({"role": "user", "content": f'''user sketch line data is of the following: {str(sketch_line_data)}. 
                          This is the user sketch, do not confuse it with the dataset the user submit previously.
                          '''})

@app.post("/query-sketch/")
async def query_sketch(data: dict):
    try:
        logger.info("Received sketch query request")
        logger.info(f"RAW request data: {data}")

        sketch = data.get("sketch")
        if not sketch:
            raise ValueError("Sketch data is missing")

        top_k = data.get("top_k", 5)
        window_length = data.get("window_length", 5)  # Get window_length from request, default to 5
        try:
            top_k = max(1, int(top_k))
            window_length = max(2, int(window_length))  # Ensure window_length is at least 2
        except ValueError:
            raise ValueError("Invalid top_k or window_length value")

        logger.info(f"Sketch data received: {sketch}, Top-K: {top_k}, Window Length: {window_length}")

        # Skip re-normalizing the sketch — already assumed normalized or left raw
        normalized_sketch = normalize_sketch(sketch)
        
        ############################################################
        update_sketch_line_data(sketch)
        ############################################################
        # Use the provided window_length for segmentation
        segmented_data_for_sketch = segment_time_series_for_sketch(time_series_data, window_length)

        logger.info(f"Z-normalized segments prepared: {len(segmented_data_for_sketch)}")

        results = perform_sketch_query(normalized_sketch, segmented_data_for_sketch, top_k)

        if not results:
            logger.warning("No matches found for the sketch query.")
            return {"predicted_query": "No matches found", "data": []}

        top_k_results = results[:top_k]
        logger.info(f"Returning Top-{top_k} results: {top_k_results}")

        return {"predicted_query": "Matched results", "data": top_k_results}

    except Exception as e:
        logger.exception(f"Query failed: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Query failed: {str(e)}")
    

def segment_time_series_for_sketch(data, window_length):
    """Segments raw time series and applies z-normalization per segment for sketch-based DTW."""
    segments = []
    for i in range(len(data) - window_length + 1):
        segment_data = data[i:i + window_length]
        
        if len(segment_data) < window_length:
            continue

        if not isinstance(segment_data, list) or not all(isinstance(point, dict) for point in segment_data):
            logger.error(f"Invalid segment at index {i}: {segment_data}")
            continue

        raw_values = [point['Value'] for point in segment_data if isinstance(point, dict) and 'Value' in point]
        z_normed_values = z_normalize(raw_values)

        # Include both normalized values and dates in each point
        segment = [
            {
                "NormalizedValue": val,
                "Date": segment_data[j]['Date']  # Include the date from original data
            } 
            for j, val in enumerate(z_normed_values)
        ]
        segments.append(segment)

    return segments


    
# def normalize_sketch(sketch):
#     """Normalize the y-values of the sketch using normalize_series()."""
#     if not isinstance(sketch, list):
#         raise ValueError("Sketch must be a list of points.")

#     y_values = np.array([point.get("y", np.nan) for point in sketch])

#     if np.isnan(y_values).all():
#         raise ValueError("Sketch contains no valid y-values.")

#     normalized_y_values = normalize_series(y_values)

#     return [{"x": point["x"], "y": normalized_y_values[i]} for i, point in enumerate(sketch)]

def normalize_sketch(sketch):
    """Assumes sketch is already drawn and pre-normalized on the frontend."""
    if not isinstance(sketch, list):
        raise ValueError("Sketch must be a list of points.")
    return sketch




def pruned_dtw(sketch_points, series_points, radius=5):
    try:
        _, cost = dtw_path_from_metric(
            sketch_points,
            series_points,
            metric="euclidean",
            global_constraint="sakoe_chiba",
            sakoe_chiba_radius=radius,
        )
        return cost
    except Exception as e:
        logger.error(f"Error in PrunedDTW computation: {e}")
        return float("inf")
    
def z_normalize(series):
    series = np.array(series)
    mean = np.mean(series)
    std = np.std(series)
    if std == 0:
        return np.zeros_like(series)
    return (series - mean) / std


def select_topk_non_overlapping(matches,top_k):
    """
    Pick up to top_k highest-scoring segments that don't overlap in time.
    - Score is the second element of each (segment, score) tuple.
    - Overlap is inclusive (touching endpoints counts as overlap).
    - Returns (segment, score) tuples only.
    """
    if top_k <= 0 or not matches:
        return []

    prepared = []
    for seg, score in matches:
        dates = [p.get("Date") for p in seg if p.get("Date") is not None]
        if not dates:
            continue
        start, end = min(dates), max(dates)
        prepared.append((start, end, seg, score))


    prepared.sort(key=lambda x: x[3])

    def overlaps(a_start, a_end, b_start, b_end) -> bool:
        # Inclusive overlap: [a,b] overlaps [c,d] if max(a,c) <= min(b,d)
        return max(a_start, b_start) <= min(a_end, b_end)

    selected = []
    for start, end, seg, score in prepared:
        if len(selected) >= top_k:
            break
        if any(overlaps(start, end, s0, s1) for s0, s1, _, _ in selected):
            continue
        selected.append((start, end, seg, score))

    return [(seg, score) for _, _, seg, score in selected]

def perform_sketch_query(sketch, segmented_data, top_k, radius=5):
    try:
        logger.info(f"Performing sketch query with segmented_data of length {len(segmented_data)}")

        if not isinstance(sketch, list):
            logger.error(f"Expected sketch to be a list, got {type(sketch)} with value {sketch}")
            raise ValueError("Sketch must be a list of dictionaries with 'x' and 'y'.")

        # Extract and normalize sketch points
        sketch_points = [(point['x'], point['y']) for point in sketch]
        logger.info(f"Normalized sketch points: {sketch_points}")

        matches = []
        for segment_idx, segment in enumerate(segmented_data):
            if not isinstance(segment, list):
                logger.error(f"Segment is not a list! Got: {type(segment)} with value: {segment}")
                raise ValueError(f"Invalid segment format: {segment}")

            # Extract and validate segment points
            series_points = []
            for j, val in enumerate(segment):
                if not isinstance(val, dict) or 'NormalizedValue' not in val:
                    logger.error(f"Invalid entry in segment: {val}")
                    raise ValueError(f"Each segment entry must be a dictionary with 'NormalizedValue'.")
                
                if not np.isnan(val['NormalizedValue']):
                    # Normalize x coordinate to match sketch x range [0,1]
                    x = j / (len(segment) - 1)
                    series_points.append((x, val['NormalizedValue']))

            if len(series_points) < 2:
                logger.warning(f"Skipping segment {segment_idx} due to insufficient valid points")
                continue

            logger.info(f"Processing segment {segment_idx}")
            logger.info(f"Series points: {series_points[:5]}...")  # Log first 5 points
            
            distance = pruned_dtw(sketch_points, series_points, radius=radius)
            logger.info(f"DTW distance for segment {segment_idx}: {distance}")

            matches.append((segment, distance))

        # Sort matches by distance and get top k


        matches = select_topk_non_overlapping(matches,top_k)

        matches.sort(key=lambda x: x[1])
        top_matches = [match[0] for match in matches[:top_k]]
        
        logger.info(f"Found {len(matches)} total matches")
        logger.info(f"Top {top_k} distances: {[match[1] for match in matches[:top_k]]}")
        
        return top_matches

    except Exception as e:
        logger.error(f"Error in perform_sketch_query: {str(e)}")
        raise



def get_response_message(msg):
    global chat_messages
    chat_messages.append({"role": "user", "content": msg})

    client = openai_client
    response = client.chat.completions.create(
    #model="gpt-4o-mini-2024-07-18",  # gpt-4o
    model = 'gpt-4o',
    messages=chat_messages,
    stream=False
    )
    full_reply = response.choices[0].message.content
    chat_messages.append({"role": "assistant", "content": full_reply})
    return full_reply

class ChatMessage(BaseModel):
    message: str
    window_length:  Optional[int] = 5

@app.post("/chat")
async def chat_endpoint(request: ChatMessage):
    global time_series_data, segment_window_list
    user_message = request.message   
    assistant_message = get_response_message(user_message)
    reply = assistant_message
    segment_window_list = []
    prev_window_size = request.window_length

    if '[CMD]' in reply:
        query = " ".join(reply.split(" ")[1:])
        
        text_window = False
        window_list = []
        if "[WINDOW]" in query:
            text = query.split("[WINDOW]")[1]
            window_numbers = text.split("[")[1].split("]")[0]
            window_list = [int(x.strip()) for x in window_numbers.split(",")]
            query = query.split("[WINDOW]")[0]
            text_window = True
            segment_window_list = window_list 
        



        current_model = selected_model
        features = process_user_query(query, request.window_length, current_model)
        if text_window:
            matched_segments = process_query_with_data(time_series_data, features, sum(window_list))#### here we start the query
        else:
            # start = time.perf_counter()
            segment_window_list = []
            matched_segments = process_query_with_data(time_series_data, features, request.window_length)#### here we start the query
            # end = time.perf_counter()
            # print("---------------------")
            # print(f"Runtime: {end - start:.6f} seconds")
        local_window = 0

        for group in features['local']:
            lengths = [local_parameters[p + "_window_size"] for p in group]
            local_window += max(lengths)

        
        reply = "Showing Query Results for: "
        reply += str(query)
        reply += f" Suggested Window Size: {local_window}"
        return {"reply": reply, "Feature Descriptions": features, "Matched Segments": matched_segments}

    print(request.window_length)

    reply = reply.replace('[MSG]', "")
    return {"reply": reply, "Feature Descriptions":[], "Matched Segments":[]}
    
