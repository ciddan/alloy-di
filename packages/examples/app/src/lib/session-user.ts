import { Injectable } from "alloy-di/runtime";

@Injectable("session")
export class SessionUser {
  public readonly username: string;
  public readonly createdAt = new Date().toISOString();

  constructor() {
    this.username = `user_${Math.random().toString(36).substring(7)}`;
    console.log(`[SessionUser] Created user: ${this.username}`);
  }

  public [Symbol.dispose]() {
    console.log(`[SessionUser] Disposing user session: ${this.username}`);
  }
}
