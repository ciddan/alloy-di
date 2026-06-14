export class ApiClient {
  constructor(public readonly baseUrl: string) {}

  public endpoint(path: string) {
    return new URL(path, this.baseUrl).toString();
  }
}

export class RequestApiClient {
  public readonly requestId = Math.random().toString(36).substring(7);

  constructor(
    private readonly apiClient: ApiClient,
    private readonly username: string,
  ) {
    console.log(
      `[RequestApiClient] Created ${this.requestId} for ${this.username}`,
    );
  }

  public describeRequest(path: string) {
    return `${this.apiClient.endpoint(path)} as ${this.username} (${this.requestId})`;
  }

  public [Symbol.dispose]() {
    console.log(`[RequestApiClient] Disposing ${this.requestId}`);
  }
}
