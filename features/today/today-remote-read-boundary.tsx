"use client";

import { Component, type ReactNode } from "react";

export function TodayRemoteReadErrorFallback({ message: _message }: { message: string }) {
  return (
    <div
      data-today-remote-error
      className="rounded-2xl border border-border bg-surface px-4 py-5"
      role="alert"
    >
      <p className="font-medium text-text">無法讀取今日預約資料</p>
      <p className="mt-1 text-[15px] text-secondary-text">請稍後再試。</p>
    </div>
  );
}

export class TodayRemoteReadErrorBoundary extends Component<
  { children: ReactNode },
  { message: string | null }
> {
  state: { message: string | null } = { message: null };

  static getDerivedStateFromError(error: unknown): { message: string } {
    return {
      message: error instanceof Error ? error.message : "Remote appointment read failed",
    };
  }

  render() {
    if (this.state.message) {
      return <TodayRemoteReadErrorFallback message={this.state.message} />;
    }
    return this.props.children;
  }
}
