import { makeAutoObservable } from "mobx";

class SketchStore {
  timeSeriesData = [];
  sketchData = [];
  results = [];

  constructor() {
    makeAutoObservable(this);
  }

  setTimeSeriesData(data) {
    this.timeSeriesData = data;
  }

  setSketchData(data) {
    this.sketchData = data;
  }

  setResults(data) {
    this.results = data;
  }
}

const store = new SketchStore();
export default store;
