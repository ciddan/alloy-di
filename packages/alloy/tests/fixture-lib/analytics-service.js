export class AnalyticsService {
  constructor() {
    this.events = [];
  }
  track(name, data) {
    this.events.push({ name, data });
  }
}
