import { deps, Injectable } from "alloy-di/runtime";
import { SessionUser } from "./session-user";

@Injectable(deps(SessionUser), "request")
export class RequestLogger {
  public readonly requestId = Math.random().toString(36).substring(7);

  constructor(private user: SessionUser) {
    console.log(
      `[RequestLogger] Initialized request ${this.requestId} for user ${this.user.username}`,
    );
  }

  public log(msg: string) {
    console.log(
      `[RequestLogger - ${this.requestId}] [${this.user.username}] ${msg}`,
    );
  }

  public [Symbol.dispose]() {
    console.log(`[RequestLogger] Disposing request context: ${this.requestId}`);
  }
}
