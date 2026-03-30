<p align="left">
<img width=15% src="" alt="" />
<i>Time Series Visual Analytics Project</i>
</p>

## License



# ShapeTalk

**ShapeTalk** is a multimodal visual analytics system for intuitive time-series querying and exploration.

## Prerequisites

Make sure you have installed all of the following prerequisites on your development machine:

-   **Node.js (>= 22.15.0)** - [Download & Install Node.js](https://nodejs.org/en/download/) and the npm package manager.
-   **reqirements.txt**  

## Get Started

### Install

Download the repository

```bash
$ git clone [github repo]
```

Install Prerequisites

```bash
$ pip install -r requirements.txt
```

```bash
$ npm install
```

```bash
$ cd frontend
$ npm install
```

To avoid version conflicts and dependency issues, we have locked the versions of all packages and their dependencies in `package-lock.json`. The execution of the `npm install` command will, by default, install all packages using exactly the same versions specified in the `package-lock.json`.

### Put your OpenAI API Key

Edit and put OpenAI API Key in 
```
backend\config.py
```

In config.py replace [Your OpenAI Key] with the actual key
```
API_KEY = "[Your OpenAI Key]"
```

You can obtain an OpenAI API Key through the official website [here](https://openai.com/api/)


### Running Your Application

#### 1. Run Backend
```bash
$ cd backend
$ uvicorn main:app --reload --host 0.0.0.0 --port 8000 --reload
```

#### 2.Run Frontend

Open a new terminal

```bash
$ cd frontend
$ npm start
```

Your application should run on **port 3000** Go to [http://localhost:3000](http://localhost:3000) in your browser (Chrome recommended).

## Citation
