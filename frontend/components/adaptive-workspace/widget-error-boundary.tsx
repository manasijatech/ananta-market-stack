"use client";

import { Component, type ErrorInfo, type ReactNode } from "react";

type Props = {
    children: ReactNode;
    label?: string;
};

type State = {
    error: string | null;
};

export class WidgetErrorBoundary extends Component<Props, State> {
    state: State = { error: null };

    static getDerivedStateFromError(error: Error): State {
        return { error: error.message || "This widget failed to render." };
    }

    componentDidCatch(error: Error, info: ErrorInfo) {
        console.error("[widget-error-boundary]", this.props.label, error, info.componentStack);
    }

    render() {
        if (this.state.error) {
            return (
                <p className="p-3 text-sm text-destructive">
                    {this.props.label ? `${this.props.label}: ` : ""}
                    {this.state.error}
                </p>
            );
        }
        return this.props.children;
    }
}
