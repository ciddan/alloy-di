import { deps, Injectable } from "alloy-di/runtime";
import type { RequestApiClient } from "./api-client";
import { SessionUser } from "./session-user";
import { RequestApiClientToken } from "./tokens";

@Injectable(deps(SessionUser, RequestApiClientToken), "request")
export class RequestLogger {
  public readonly requestId = Math.random().toString(36).substring(7);

  constructor(
    private user: SessionUser,
    private requestApiClient: RequestApiClient,
  ) {
    console.log(
      `[RequestLogger] Initialized request ${this.requestId} for user ${this.user.username}`,
    );
  }

  public log(msg: string) {
    console.log(
      `[RequestLogger - ${this.requestId}] [${this.user.username}] ${msg}`,
    );
  }

  public describeApiRequest(path: string) {
    return this.requestApiClient.describeRequest(path);
  }

  public [Symbol.dispose]() {
    console.log(`[RequestLogger] Disposing request context: ${this.requestId}`);
  }
}
