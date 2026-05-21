"use client";

import { type HTMLAttributes, useEffect, useRef } from "react";

import { cn } from "@/lib/utils";

type MediaElementGraph = {
    analyser: AnalyserNode;
    context: AudioContext;
};

const mediaElementGraphCache = new WeakMap<HTMLAudioElement, MediaElementGraph>();

function getMediaElementGraph(
    mediaElement: HTMLAudioElement,
    fftSize: number,
    smoothingTimeConstant: number
): MediaElementGraph | null {
    const existing = mediaElementGraphCache.get(mediaElement);
    if (existing && existing.context.state !== "closed") {
        existing.analyser.fftSize = fftSize;
        existing.analyser.smoothingTimeConstant = smoothingTimeConstant;
        return existing;
    }

    const AudioContextConstructor =
        window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;

    if (!AudioContextConstructor) return null;

    const context = new AudioContextConstructor();
    const analyser = context.createAnalyser();
    analyser.fftSize = fftSize;
    analyser.smoothingTimeConstant = smoothingTimeConstant;

    try {
        const source = context.createMediaElementSource(mediaElement);
        source.connect(analyser);
        source.connect(context.destination);
    } catch {
        void context.close();
        return null;
    }

    const graph = { analyser, context };
    mediaElementGraphCache.set(mediaElement, graph);
    return graph;
}

export type LiveWaveformProps = HTMLAttributes<HTMLDivElement> & {
    active?: boolean;
    processing?: boolean;
    mediaElementRef?: React.RefObject<HTMLAudioElement | null>;
    deviceId?: string;
    barWidth?: number;
    barHeight?: number;
    barGap?: number;
    barRadius?: number;
    barColor?: string;
    fadeEdges?: boolean;
    fadeWidth?: number;
    height?: string | number;
    sensitivity?: number;
    smoothingTimeConstant?: number;
    fftSize?: number;
    historySize?: number;
    updateRate?: number;
    mode?: "scrolling" | "static";
    onError?: (error: Error) => void;
    onLevelChange?: (level: number) => void;
    onStreamReady?: (stream: MediaStream) => void;
    onStreamEnd?: () => void;
};

export function LiveWaveform({
    active = false,
    processing = false,
    mediaElementRef,
    deviceId,
    barWidth = 3,
    barGap = 1,
    barRadius = 1.5,
    barColor,
    fadeEdges = true,
    fadeWidth = 24,
    barHeight: baseBarHeight = 4,
    height = 64,
    sensitivity = 1,
    smoothingTimeConstant = 0.8,
    fftSize = 256,
    historySize = 60,
    updateRate = 30,
    mode = "static",
    onError,
    onLevelChange,
    onStreamReady,
    onStreamEnd,
    className,
    ...props
}: LiveWaveformProps) {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const containerRef = useRef<HTMLDivElement>(null);
    const historyRef = useRef<number[]>([]);
    const analyserRef = useRef<AnalyserNode | null>(null);
    const audioContextRef = useRef<AudioContext | null>(null);
    const streamRef = useRef<MediaStream | null>(null);
    const animationRef = useRef<number>(0);
    const lastUpdateRef = useRef<number>(0);
    const processingAnimationRef = useRef<number | null>(null);
    const lastActiveDataRef = useRef<number[]>([]);
    const transitionProgressRef = useRef(0);
    const staticBarsRef = useRef<number[]>([]);
    const needsRedrawRef = useRef(true);
    const gradientCacheRef = useRef<CanvasGradient | null>(null);
    const lastWidthRef = useRef(0);

    const heightStyle = typeof height === "number" ? `${height}px` : height;

    useEffect(() => {
        const canvas = canvasRef.current;
        const container = containerRef.current;
        if (!canvas || !container) return;

        const resizeObserver = new ResizeObserver(() => {
            const rect = container.getBoundingClientRect();
            const dpr = window.devicePixelRatio || 1;

            canvas.width = rect.width * dpr;
            canvas.height = rect.height * dpr;
            canvas.style.width = `${rect.width}px`;
            canvas.style.height = `${rect.height}px`;

            const ctx = canvas.getContext("2d");
            if (ctx) {
                ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
            }

            gradientCacheRef.current = null;
            lastWidthRef.current = rect.width;
            needsRedrawRef.current = true;
        });

        resizeObserver.observe(container);
        return () => resizeObserver.disconnect();
    }, []);

    useEffect(() => {
        if (processing && !active) {
            let time = 0;
            transitionProgressRef.current = 0;

            const animateProcessing = () => {
                time += 0.03;
                transitionProgressRef.current = Math.min(1, transitionProgressRef.current + 0.02);

                const processingData = [];
                const barCount = Math.floor(
                    (containerRef.current?.getBoundingClientRect().width || 200) / (barWidth + barGap)
                );

                if (mode === "static") {
                    const halfCount = Math.floor(barCount / 2);

                    for (let i = 0; i < barCount; i += 1) {
                        const normalizedPosition = halfCount > 0 ? (i - halfCount) / halfCount : 0;
                        const centerWeight = 1 - Math.abs(normalizedPosition) * 0.4;
                        const wave1 = Math.sin(time * 1.5 + normalizedPosition * 3) * 0.25;
                        const wave2 = Math.sin(time * 0.8 - normalizedPosition * 2) * 0.2;
                        const wave3 = Math.cos(time * 2 + normalizedPosition) * 0.15;
                        const processingValue = (0.2 + wave1 + wave2 + wave3) * centerWeight;

                        let finalValue = processingValue;
                        if (lastActiveDataRef.current.length > 0 && transitionProgressRef.current < 1) {
                            const lastDataIndex = Math.min(i, lastActiveDataRef.current.length - 1);
                            const lastValue = lastActiveDataRef.current[lastDataIndex] || 0;
                            finalValue =
                                lastValue * (1 - transitionProgressRef.current) +
                                processingValue * transitionProgressRef.current;
                        }

                        processingData.push(Math.max(0.05, Math.min(1, finalValue)));
                    }
                } else {
                    for (let i = 0; i < barCount; i += 1) {
                        const normalizedPosition = (i - barCount / 2) / (barCount / 2);
                        const centerWeight = 1 - Math.abs(normalizedPosition) * 0.4;
                        const wave1 = Math.sin(time * 1.5 + i * 0.15) * 0.25;
                        const wave2 = Math.sin(time * 0.8 - i * 0.1) * 0.2;
                        const wave3 = Math.cos(time * 2 + i * 0.05) * 0.15;
                        const processingValue = (0.2 + wave1 + wave2 + wave3) * centerWeight;

                        let finalValue = processingValue;
                        if (lastActiveDataRef.current.length > 0 && transitionProgressRef.current < 1) {
                            const lastDataIndex = Math.floor((i / barCount) * lastActiveDataRef.current.length);
                            const lastValue = lastActiveDataRef.current[lastDataIndex] || 0;
                            finalValue =
                                lastValue * (1 - transitionProgressRef.current) +
                                processingValue * transitionProgressRef.current;
                        }

                        processingData.push(Math.max(0.05, Math.min(1, finalValue)));
                    }
                }

                if (mode === "static") {
                    staticBarsRef.current = processingData;
                } else {
                    historyRef.current = processingData;
                }

                needsRedrawRef.current = true;
                processingAnimationRef.current = requestAnimationFrame(animateProcessing);
            };

            animateProcessing();

            return () => {
                if (processingAnimationRef.current) {
                    cancelAnimationFrame(processingAnimationRef.current);
                }
            };
        }

        if (!active && !processing) {
            const hasData = mode === "static" ? staticBarsRef.current.length > 0 : historyRef.current.length > 0;

            if (hasData) {
                let fadeProgress = 0;
                const fadeToIdle = () => {
                    fadeProgress += 0.03;
                    if (fadeProgress < 1) {
                        if (mode === "static") {
                            staticBarsRef.current = staticBarsRef.current.map((value) => value * (1 - fadeProgress));
                        } else {
                            historyRef.current = historyRef.current.map((value) => value * (1 - fadeProgress));
                        }
                        needsRedrawRef.current = true;
                        requestAnimationFrame(fadeToIdle);
                    } else if (mode === "static") {
                        staticBarsRef.current = [];
                    } else {
                        historyRef.current = [];
                    }
                };
                fadeToIdle();
            }
        }
    }, [processing, active, barWidth, barGap, mode]);

    useEffect(() => {
        if (!active) {
            if (streamRef.current) {
                streamRef.current.getTracks().forEach((track) => track.stop());
                streamRef.current = null;
                onStreamEnd?.();
            }
            if (audioContextRef.current && audioContextRef.current.state !== "closed") {
                void audioContextRef.current.close();
                audioContextRef.current = null;
            }
            analyserRef.current = null;
            if (animationRef.current) {
                cancelAnimationFrame(animationRef.current);
                animationRef.current = 0;
            }
            return;
        }

        const mediaElement = mediaElementRef?.current;

        if (mediaElement) {
            const graph = getMediaElementGraph(mediaElement, fftSize, smoothingTimeConstant);
            if (!graph) return;

            analyserRef.current = graph.analyser;
            historyRef.current = [];
            void graph.context.resume();

            return () => {
                analyserRef.current = null;
                if (animationRef.current) {
                    cancelAnimationFrame(animationRef.current);
                    animationRef.current = 0;
                }
            };
        }

        const setupMicrophone = async () => {
            try {
                const stream = await navigator.mediaDevices.getUserMedia({
                    audio: deviceId
                        ? {
                              deviceId: { exact: deviceId },
                              echoCancellation: true,
                              noiseSuppression: true,
                              autoGainControl: true
                          }
                        : {
                              echoCancellation: true,
                              noiseSuppression: true,
                              autoGainControl: true
                          }
                });
                streamRef.current = stream;
                onStreamReady?.(stream);

                const AudioContextConstructor =
                    window.AudioContext ||
                    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;

                if (!AudioContextConstructor) return;

                const audioContext = new AudioContextConstructor();
                if (audioContext.state === "suspended") {
                    await audioContext.resume();
                }
                const analyser = audioContext.createAnalyser();
                analyser.fftSize = fftSize;
                analyser.smoothingTimeConstant = smoothingTimeConstant;

                const source = audioContext.createMediaStreamSource(stream);
                source.connect(analyser);

                audioContextRef.current = audioContext;
                analyserRef.current = analyser;
                historyRef.current = [];
            } catch (error) {
                onError?.(error as Error);
            }
        };

        void setupMicrophone();

        return () => {
            if (streamRef.current) {
                streamRef.current.getTracks().forEach((track) => track.stop());
                streamRef.current = null;
                onStreamEnd?.();
            }
            if (audioContextRef.current && audioContextRef.current.state !== "closed") {
                void audioContextRef.current.close();
                audioContextRef.current = null;
            }
            analyserRef.current = null;
            if (animationRef.current) {
                cancelAnimationFrame(animationRef.current);
                animationRef.current = 0;
            }
        };
    }, [active, mediaElementRef, deviceId, fftSize, smoothingTimeConstant, onError, onStreamReady, onStreamEnd]);

    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;

        const ctx = canvas.getContext("2d");
        if (!ctx) return;

        let rafId: number;

        const animate = (currentTime: number) => {
            const rect = canvas.getBoundingClientRect();

            if (active && currentTime - lastUpdateRef.current > updateRate) {
                lastUpdateRef.current = currentTime;

                if (analyserRef.current) {
                    const dataArray = new Uint8Array(analyserRef.current.frequencyBinCount);
                    analyserRef.current.getByteFrequencyData(dataArray);

                    if (mode === "static") {
                        const startFreq = Math.floor(dataArray.length * 0.05);
                        const endFreq = Math.floor(dataArray.length * 0.4);
                        const relevantData = dataArray.slice(startFreq, endFreq);
                        const barCount = Math.floor(rect.width / (barWidth + barGap));
                        const halfCount = Math.floor(barCount / 2);
                        const newBars: number[] = [];

                        for (let i = halfCount - 1; i >= 0; i -= 1) {
                            const dataIndex = Math.floor((i / halfCount) * relevantData.length);
                            const value = Math.min(1, ((relevantData[dataIndex] ?? 0) / 255) * sensitivity);
                            newBars.push(Math.max(0.05, value));
                        }

                        for (let i = 0; i < halfCount; i += 1) {
                            const dataIndex = Math.floor((i / halfCount) * relevantData.length);
                            const value = Math.min(1, ((relevantData[dataIndex] ?? 0) / 255) * sensitivity);
                            newBars.push(Math.max(0.05, value));
                        }

                        staticBarsRef.current = newBars;
                        lastActiveDataRef.current = newBars;
                        if (newBars.length > 0) {
                            onLevelChange?.(newBars.reduce((sum, value) => sum + value, 0) / newBars.length);
                        }
                    } else {
                        let sum = 0;
                        const startFreq = Math.floor(dataArray.length * 0.05);
                        const endFreq = Math.floor(dataArray.length * 0.4);
                        const relevantData = dataArray.slice(startFreq, endFreq);

                        for (let i = 0; i < relevantData.length; i += 1) {
                            sum += relevantData[i] ?? 0;
                        }
                        const average = (sum / relevantData.length / 255) * sensitivity;

                        historyRef.current.push(Math.min(1, Math.max(0.05, average)));
                        lastActiveDataRef.current = [...historyRef.current];
                        onLevelChange?.(Math.min(1, Math.max(0.05, average)));

                        if (historyRef.current.length > historySize) {
                            historyRef.current.shift();
                        }
                    }
                    needsRedrawRef.current = true;
                }
            }

            if (!needsRedrawRef.current && !active) {
                rafId = requestAnimationFrame(animate);
                return;
            }

            needsRedrawRef.current = active;
            ctx.clearRect(0, 0, rect.width, rect.height);

            const computedBarColor =
                barColor ||
                (() => {
                    const style = getComputedStyle(canvas);
                    return style.color || "#000";
                })();

            const step = barWidth + barGap;
            const barCount = Math.floor(rect.width / step);
            const centerY = rect.height / 2;
            const dataToRender =
                mode === "static"
                    ? processing || active || staticBarsRef.current.length > 0
                        ? staticBarsRef.current
                        : []
                    : historyRef.current;

            if (mode === "static") {
                for (let i = 0; i < barCount && i < dataToRender.length; i += 1) {
                    const value = dataToRender[i] || 0.1;
                    const x = i * step;
                    const renderedBarHeight = Math.max(baseBarHeight, value * rect.height * 0.8);
                    const y = centerY - renderedBarHeight / 2;

                    ctx.fillStyle = computedBarColor;
                    ctx.globalAlpha = 0.4 + value * 0.6;

                    if (barRadius > 0) {
                        ctx.beginPath();
                        ctx.roundRect(x, y, barWidth, renderedBarHeight, barRadius);
                        ctx.fill();
                    } else {
                        ctx.fillRect(x, y, barWidth, renderedBarHeight);
                    }
                }
            } else {
                for (let i = 0; i < barCount && i < historyRef.current.length; i += 1) {
                    const dataIndex = historyRef.current.length - 1 - i;
                    const value = historyRef.current[dataIndex] || 0.1;
                    const x = rect.width - (i + 1) * step;
                    const renderedBarHeight = Math.max(baseBarHeight, value * rect.height * 0.8);
                    const y = centerY - renderedBarHeight / 2;

                    ctx.fillStyle = computedBarColor;
                    ctx.globalAlpha = 0.4 + value * 0.6;

                    if (barRadius > 0) {
                        ctx.beginPath();
                        ctx.roundRect(x, y, barWidth, renderedBarHeight, barRadius);
                        ctx.fill();
                    } else {
                        ctx.fillRect(x, y, barWidth, renderedBarHeight);
                    }
                }
            }

            if (fadeEdges && fadeWidth > 0 && rect.width > 0) {
                if (!gradientCacheRef.current || lastWidthRef.current !== rect.width) {
                    const gradient = ctx.createLinearGradient(0, 0, rect.width, 0);
                    const fadePercent = Math.min(0.3, fadeWidth / rect.width);

                    gradient.addColorStop(0, "rgba(255,255,255,1)");
                    gradient.addColorStop(fadePercent, "rgba(255,255,255,0)");
                    gradient.addColorStop(1 - fadePercent, "rgba(255,255,255,0)");
                    gradient.addColorStop(1, "rgba(255,255,255,1)");

                    gradientCacheRef.current = gradient;
                    lastWidthRef.current = rect.width;
                }

                ctx.globalCompositeOperation = "destination-out";
                ctx.fillStyle = gradientCacheRef.current;
                ctx.fillRect(0, 0, rect.width, rect.height);
                ctx.globalCompositeOperation = "source-over";
            }

            ctx.globalAlpha = 1;
            rafId = requestAnimationFrame(animate);
        };

        rafId = requestAnimationFrame(animate);

        return () => {
            if (rafId) {
                cancelAnimationFrame(rafId);
            }
        };
    }, [
        active,
        processing,
        sensitivity,
        updateRate,
        historySize,
        barWidth,
        baseBarHeight,
        barGap,
        barRadius,
        barColor,
        fadeEdges,
        fadeWidth,
        mode,
        onLevelChange
    ]);

    return (
        <div
            aria-label={active ? "Live audio waveform" : processing ? "Processing audio" : "Audio waveform idle"}
            className={cn("relative h-full w-full", className)}
            ref={containerRef}
            role="img"
            style={{ height: heightStyle }}
            {...props}
        >
            {!active && !processing ? (
                <div className="absolute left-0 right-0 top-1/2 -translate-y-1/2 border-t-2 border-dotted border-muted-foreground/20" />
            ) : null}
            <canvas className="block h-full w-full" ref={canvasRef} />
        </div>
    );
}
