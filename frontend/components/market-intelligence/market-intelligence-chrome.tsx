"use client";

import {
	Bell,
	IndianRupee,
	Info,
	Megaphone,
	MessageSquare,
	Newspaper,
	Search,
	X,
	type LucideIcon,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { createPortal } from "react-dom";
import { AlphaCreditWarningTrigger } from "@/components/alpha/alpha-credit-warning-modal";
import { parseActionError } from "@/components/brokers/action-error";
import { brokerNames, PageHeader } from "@/components/brokers/ui";
import {
	FeedSearchInput,
	LiveStatusPill,
	WatchlistScopeTooltip,
} from "@/components/market-intelligence/market-intelligence-feed-primitives";
import {
	MarketIntelligenceLiveFeed,
	StateMessage,
	type MarketIntelligenceSocketState,
} from "@/components/market-intelligence/market-intelligence-live-feed";
import { MarketIntelligenceSymbolChart } from "@/components/market-intelligence/market-intelligence-symbol-chart";
import { Button } from "@/components/ui/button";
import {
	Card,
	CardFrame,
	CardFrameAction,
	CardFrameDescription,
	CardFrameHeader,
	CardFrameTitle,
	CardPanel,
} from "@/components/ui/card";
import {
	Dialog,
	DialogDescription,
	DialogHeader,
	DialogPanel,
	DialogPopup,
	DialogTitle,
	DialogTrigger,
} from "@/components/ui/dialog";
import { Group } from "@/components/ui/group";
import {
	InputGroup,
	InputGroupAddon,
	InputGroupInput,
} from "@/components/ui/input-group";
import { SimpleSelect } from "@/components/ui/simple-select";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { getAlphaAlerts } from "@/service/actions/alpha/alerts";
import { getAlphaAnnouncements } from "@/service/actions/alpha/announcements";
import { getAlphaConcalls } from "@/service/actions/alpha/concalls";
import { getAlphaEarnings } from "@/service/actions/alpha/earnings";
import { getAlphaNews } from "@/service/actions/alpha/news";
import { getAlphaSymbolMetadata } from "@/service/actions/alpha/symbols";
import type { AlphaSymbolMetadata } from "@/service/types/alpha/symbols";
import {
	getBrokerDataDefaultConfig,
	getMarketChartData,
	searchBrokerInstruments,
} from "@/service/actions/broker";
import type {
	BrokerDataDefaultAccount,
	InstrumentRef,
	InstrumentSearchRow,
	MarketChartSnapshot,
} from "@/service/types/broker";
import {
	getAlphaCreditWarningMessage,
	notifyAlphaCreditWarning,
} from "@/lib/alpha-credit-warning";
import {
	ALPHA_SYMBOL_LIMIT,
	emptyMarketIntelligenceFeeds,
	marketIntelligenceSections,
	type AlphaSection,
	type MarketIntelligenceFeeds,
	type WatchlistCoverageGroup,
} from "@/components/market-intelligence/market-intelligence-data";

const sectionChrome = {
	news: {
		icon: Newspaper,
	},
	announcements: {
		icon: Megaphone,
	},
	earnings: {
		icon: IndianRupee,
	},
	concalls: {
		icon: MessageSquare,
	},
	alerts: {
		icon: Bell,
	},
} satisfies Record<AlphaSection, { icon: LucideIcon }>;

const intelligenceHelpItems = [
	{
		title: "News",
		body: "Market news and company-specific coverage from media sources. Use it for external context around price action, sentiment, and public market narratives.",
	},
	{
		title: "Announcements",
		body: "Official exchange and company disclosures, including board updates, corporate actions, regulatory filings, and other company-published events.",
	},
	{
		title: "Earnings",
		body: "Earnings-related disclosures and management guidance. These records highlight result updates and material financial context.",
	},
	{
		title: "Concalls",
		body: "Conference call summaries, transcripts, and management commentary from investor calls. Transcript and audio actions appear when the feed includes those links.",
	},
	{
		title: "Alerts",
		body: "Signal-style market alerts for price moves, volume spikes, 52-week levels, earnings, announcements, and other notable events.",
	},
];

const ALL_WATCHLISTS_ID = "__all_watchlists__";

type BrokerChartState = {
	error: string;
	isLoading: boolean;
	snapshot: MarketChartSnapshot | null;
};

function isoDateDaysAgo(days: number): string {
	const date = new Date();
	date.setDate(date.getDate() - days);
	return date.toISOString().slice(0, 10);
}

function todayIsoDate(): string {
	return new Date().toISOString().slice(0, 10);
}

function metadataBySymbol(items: AlphaSymbolMetadata[]) {
	return items.reduce<Record<string, AlphaSymbolMetadata>>((acc, item) => {
		const symbol = item.symbol?.trim().toUpperCase();
		if (symbol) acc[symbol] = item;
		return acc;
	}, {});
}

function instrumentFromSearch(row: InstrumentSearchRow): InstrumentRef {
	return {
		symbol: row.symbol,
		exchange: row.exchange ?? null,
		zerodha_instrument_token: row.identifiers.zerodha_instrument_token
			? Number(row.identifiers.zerodha_instrument_token)
			: null,
		upstox_instrument_key: row.identifiers.upstox_instrument_key ?? null,
		angel_exchange: row.identifiers.angel_exchange ?? row.exchange ?? null,
		angel_token: row.identifiers.angel_token
			? Number(row.identifiers.angel_token)
			: null,
		dhan_exchange_segment: row.identifiers.dhan_exchange_segment ?? null,
		dhan_security_id: row.identifiers.dhan_security_id ?? null,
		groww_exchange: row.identifiers.groww_exchange ?? row.exchange ?? null,
		groww_segment: row.identifiers.groww_segment ?? row.segment ?? null,
		groww_trading_symbol:
			row.identifiers.groww_trading_symbol ?? row.trading_symbol ?? null,
		indmoney_scrip_code: row.identifiers.indmoney_scrip_code ?? null,
		kotak_query: row.identifiers.kotak_query ?? null,
		kotak_segment: row.identifiers.kotak_segment ?? null,
		kotak_psymbol: row.identifiers.kotak_psymbol ?? null,
	};
}

const DERIVATIVE_EXCHANGES = new Set(["NFO", "BFO", "CDS", "MCX"]);
const EQUITY_INSTRUMENT_TYPES = new Set([
	"E",
	"EQ",
	"EQUITY",
	"STOCK",
	"CASH",
	"NSE_EQ",
	"BSE_EQ",
	"BE",
]);
const DERIVATIVE_INSTRUMENT_TYPES = new Set([
	"FUT",
	"FUTSTK",
	"FUTIDX",
	"OPT",
	"OPTSTK",
	"OPTIDX",
	"CE",
	"PE",
]);
const DERIVATIVE_SEGMENT_PATTERN =
	/\b(?:F&O|FNO|FO|FUT|OPT|DERIV|NFO|BFO|CDS|MCX)\b/i;
const DERIVATIVE_SYMBOL_PATTERN =
	/(?:^|[-_])(?:JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)\d{4}(?:[-_]\d+(?:\.\d+)?)?(?:[-_](?:CE|PE))?(?:[-_]|$)|(?:^|[-_])(?:FUT|CE|PE)(?:[-_]|$)/i;
const CONTRACT_MONTH_PATTERN =
	/[-_](?:JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)\d{4}/i;
const FUTURE_TOKEN_PATTERN = /[-_]FUT(?:[-_]|$)/i;

function isLikelyEquitySymbol(value: string): boolean {
	const symbol = value.trim().toUpperCase();
	return Boolean(symbol) && !DERIVATIVE_SYMBOL_PATTERN.test(symbol);
}

function isEquitySearchRow(row: InstrumentSearchRow): boolean {
	if (
		!isLikelyEquitySymbol(row.symbol) ||
		(row.trading_symbol && !isLikelyEquitySymbol(row.trading_symbol))
	) {
		return false;
	}
	if (row.expiry || row.strike || row.option_type) return false;

	const exchange = row.exchange?.trim().toUpperCase();
	if (exchange && DERIVATIVE_EXCHANGES.has(exchange)) return false;

	const instrumentType = row.instrument_type?.trim().toUpperCase();
	if (instrumentType && DERIVATIVE_INSTRUMENT_TYPES.has(instrumentType))
		return false;
	if (instrumentType && !EQUITY_INSTRUMENT_TYPES.has(instrumentType))
		return false;

	const segment = row.segment?.trim().toUpperCase();
	if (segment && DERIVATIVE_SEGMENT_PATTERN.test(segment)) return false;

	return true;
}

function marketIntelligenceSymbolFromValue(value: string): string {
	const symbol = value.trim().toUpperCase();
	const monthIndex = symbol.search(CONTRACT_MONTH_PATTERN);
	if (monthIndex > 0) return symbol.slice(0, monthIndex);

	const futureIndex = symbol.search(FUTURE_TOKEN_PATTERN);
	if (futureIndex > 0) return symbol.slice(0, futureIndex);

	return symbol;
}

function marketIntelligenceSymbolFromSearch(row: InstrumentSearchRow): string {
	if (isEquitySearchRow(row)) return row.symbol.trim().toUpperCase();
	return marketIntelligenceSymbolFromValue(
		row.symbol || row.trading_symbol || "",
	);
}

function manualInstrument(symbol: string): InstrumentRef {
	return { symbol: symbol.trim().toUpperCase() };
}

function defaultAccountLabel(account: BrokerDataDefaultAccount | null): string {
	if (!account) return "No default broker";
	const brokerCode = account.broker_code as keyof typeof brokerNames;
	const broker = brokerNames[brokerCode] ?? account.broker_code;
	return `${account.label} / ${broker}`;
}

async function loadFeeds(symbols: string[]): Promise<MarketIntelligenceFeeds> {
	if (!symbols.length) return emptyMarketIntelligenceFeeds();
	const params = {
		symbols: symbols.slice(0, ALPHA_SYMBOL_LIMIT),
		from: isoDateDaysAgo(30),
		to: todayIsoDate(),
		page: 1,
		limit: 20,
		detailed: true,
	};
	const [news, announcements, earnings, concalls, alerts] =
		await Promise.allSettled([
			getAlphaNews(params),
			getAlphaAnnouncements(params),
			getAlphaEarnings(params),
			getAlphaConcalls(params),
			getAlphaAlerts(params),
		]);

	const creditWarningMessage = getAlphaCreditWarningMessage(
		news,
		announcements,
		earnings,
		concalls,
		alerts,
	);
	if (creditWarningMessage) notifyAlphaCreditWarning(creditWarningMessage);

	return {
		news: news.status === "fulfilled" ? (news.value.data ?? []) : [],
		announcements:
			announcements.status === "fulfilled"
				? (announcements.value.data ?? [])
				: [],
		earnings:
			earnings.status === "fulfilled" ? (earnings.value.data ?? []) : [],
		concalls:
			concalls.status === "fulfilled" ? (concalls.value.data ?? []) : [],
		alerts: alerts.status === "fulfilled" ? (alerts.value.data ?? []) : [],
	};
}

export function MarketIntelligenceChrome({
	allSymbolsCount,
	children,
	creditWarningMessage,
	error,
	initialFeeds,
	symbolMetadata,
	symbols,
	streamSymbols,
	watchlistGroups,
}: {
	allSymbolsCount: number;
	children: React.ReactNode;
	creditWarningMessage?: string | null;
	error?: string;
	initialFeeds: MarketIntelligenceFeeds;
	symbolMetadata: Record<string, AlphaSymbolMetadata>;
	symbols: string[];
	streamSymbols: string[];
	watchlistGroups: WatchlistCoverageGroup[];
}) {
	const [activeSectionId, setActiveSectionId] = useState<AlphaSection>(
		marketIntelligenceSections[0].id,
	);
	const [selectedWatchlistId, setSelectedWatchlistId] =
		useState(ALL_WATCHLISTS_ID);
	const [feeds, setFeeds] = useState(initialFeeds);
	const [activeMetadata, setActiveMetadata] = useState(symbolMetadata);
	const [defaultBrokerAccount, setDefaultBrokerAccount] =
		useState<BrokerDataDefaultAccount | null>(null);
	const [brokerConfigError, setBrokerConfigError] = useState("");
	const [isLoadingBrokerConfig, setIsLoadingBrokerConfig] = useState(true);
	const [filterError, setFilterError] = useState("");
	const [isLoadingFilter, setIsLoadingFilter] = useState(false);
	const [feedSearch, setFeedSearch] = useState("");
	const [socketState, setSocketState] =
		useState<MarketIntelligenceSocketState>("connecting");
	const [searchText, setSearchText] = useState("");
	const [committedSymbol, setCommittedSymbol] = useState("");
	const [committedIntelligenceSymbol, setCommittedIntelligenceSymbol] =
		useState("");
	const [committedInstrument, setCommittedInstrument] =
		useState<InstrumentRef | null>(null);
	const [suggestions, setSuggestions] = useState<InstrumentSearchRow[]>([]);
	const [suggestionMetadata, setSuggestionMetadata] = useState<
		Record<string, AlphaSymbolMetadata>
	>({});
	const [isLoadingSuggestions, setIsLoadingSuggestions] = useState(false);
	const [showSuggestions, setShowSuggestions] = useState(false);
	const [symbolError, setSymbolError] = useState("");
	const [isLoadingSymbolFeed, setIsLoadingSymbolFeed] = useState(false);
	const [suggestionMenuRect, setSuggestionMenuRect] = useState<{
		left: number;
		top: number;
		width: number;
	} | null>(null);
	const searchAnchorRef = useRef<HTMLDivElement | null>(null);
	const [chartState, setChartState] = useState<BrokerChartState>({
		error: "",
		isLoading: false,
		snapshot: null,
	});
	const activeSection =
		marketIntelligenceSections.find((item) => item.id === activeSectionId) ??
		marketIntelligenceSections[0];
	const selectedWatchlist =
		watchlistGroups.find((item) => item.id === selectedWatchlistId) ?? null;
	const activeSymbols = useMemo(
		() => (selectedWatchlist ? selectedWatchlist.symbols : streamSymbols),
		[selectedWatchlist, streamSymbols],
	);
	const filterLabel = selectedWatchlist
		? selectedWatchlist.name
		: "All watchlists";
	const symbolModeActive = Boolean(committedSymbol);
	const suggestionsOpen = showSuggestions && Boolean(searchText.trim());
	const visibleSymbols = useMemo(
		() =>
			symbolModeActive
				? [committedIntelligenceSymbol || committedSymbol]
				: activeSymbols,
		[
			activeSymbols,
			committedIntelligenceSymbol,
			committedSymbol,
			symbolModeActive,
		],
	);
	const chartMetadata = useMemo(() => {
		if (!symbolModeActive || !committedSymbol || !committedIntelligenceSymbol)
			return activeMetadata;
		const underlyingMetadata = activeMetadata[committedIntelligenceSymbol];
		if (!underlyingMetadata || activeMetadata[committedSymbol])
			return activeMetadata;
		return { ...activeMetadata, [committedSymbol]: underlyingMetadata };
	}, [
		activeMetadata,
		committedIntelligenceSymbol,
		committedSymbol,
		symbolModeActive,
	]);

	useEffect(() => {
		if (!suggestionsOpen) {
			setSuggestionMenuRect(null);
			return;
		}

		function updateMenuRect() {
			const anchor = searchAnchorRef.current;
			if (!anchor) return;
			const rect = anchor.getBoundingClientRect();
			setSuggestionMenuRect({
				left: rect.left,
				top: rect.bottom + 4,
				width: rect.width,
			});
		}

		updateMenuRect();
		window.addEventListener("resize", updateMenuRect);
		window.addEventListener("scroll", updateMenuRect, true);
		return () => {
			window.removeEventListener("resize", updateMenuRect);
			window.removeEventListener("scroll", updateMenuRect, true);
		};
	}, [isLoadingSuggestions, suggestions.length, suggestionsOpen]);

	useEffect(() => {
		let cancelled = false;
		setIsLoadingBrokerConfig(true);
		setBrokerConfigError("");
		void (async () => {
			try {
				const config = await getBrokerDataDefaultConfig();
				if (cancelled) return;
				const effective =
					config.accounts.find(
						(account) =>
							account.account_id === config.effective_default_account_id,
					) ?? null;
				setDefaultBrokerAccount(effective);
			} catch (caught) {
				if (cancelled) return;
				setDefaultBrokerAccount(null);
				setBrokerConfigError(parseActionError(caught).message);
			} finally {
				if (!cancelled) setIsLoadingBrokerConfig(false);
			}
		})();
		return () => {
			cancelled = true;
		};
	}, []);

	useEffect(() => {
		if (symbolModeActive) {
			setIsLoadingFilter(false);
			return;
		}
		if (selectedWatchlistId === ALL_WATCHLISTS_ID) {
			setFeeds(initialFeeds);
			setActiveMetadata(symbolMetadata);
			setFilterError("");
			setIsLoadingFilter(false);
			return;
		}

		let cancelled = false;
		setFilterError("");
		setIsLoadingFilter(true);
		void (async () => {
			const [nextMetadata, nextFeeds] = await Promise.allSettled([
				getAlphaSymbolMetadata(activeSymbols),
				loadFeeds(activeSymbols),
			]);
			if (cancelled) return;
			if (nextMetadata.status === "fulfilled") {
				setActiveMetadata(metadataBySymbol(nextMetadata.value));
			} else {
				notifyAlphaCreditWarning(nextMetadata.reason);
				setActiveMetadata({});
			}
			if (nextFeeds.status === "fulfilled") {
				setFeeds(nextFeeds.value);
			} else {
				notifyAlphaCreditWarning(nextFeeds.reason);
				setFeeds(emptyMarketIntelligenceFeeds());
				setFilterError(parseActionError(nextFeeds.reason).message);
			}
			setIsLoadingFilter(false);
		})();

		return () => {
			cancelled = true;
		};
	}, [
		activeSymbols,
		initialFeeds,
		selectedWatchlistId,
		symbolMetadata,
		symbolModeActive,
	]);

	useEffect(() => {
		const query = searchText.trim();
		const accountId = defaultBrokerAccount?.account_id;
		if (!query || !accountId || query.toUpperCase() === committedSymbol) {
			setSuggestions([]);
			setSuggestionMetadata({});
			setIsLoadingSuggestions(false);
			return;
		}

		let cancelled = false;
		const handle = window.setTimeout(() => {
			setIsLoadingSuggestions(true);
			void (async () => {
				try {
					const rows = await searchBrokerInstruments(accountId, {
						q: query,
						limit: 8,
					});
					if (cancelled) return;
					setSuggestions(rows);
					setShowSuggestions(true);
					setIsLoadingSuggestions(false);
					const symbolsToLoad = Array.from(
						new Set(
							rows.map(marketIntelligenceSymbolFromSearch).filter(Boolean),
						),
					);
					if (!symbolsToLoad.length) {
						setSuggestionMetadata({});
						return;
					}
					try {
						const metadata = await getAlphaSymbolMetadata(symbolsToLoad);
						if (cancelled) return;
						setSuggestionMetadata(metadataBySymbol(metadata));
					} catch (caught) {
						notifyAlphaCreditWarning(caught);
						if (!cancelled) setSuggestionMetadata({});
					}
				} catch {
					if (cancelled) return;
					setSuggestions([]);
					setSuggestionMetadata({});
				} finally {
					if (!cancelled) setIsLoadingSuggestions(false);
				}
			})();
		}, 250);

		return () => {
			cancelled = true;
			window.clearTimeout(handle);
		};
	}, [committedSymbol, defaultBrokerAccount?.account_id, searchText]);

	useEffect(() => {
		if (!committedIntelligenceSymbol) return;

		let cancelled = false;
		setSymbolError("");
		setFilterError("");
		setIsLoadingSymbolFeed(true);
		void (async () => {
			const [nextMetadata, nextFeeds] = await Promise.allSettled([
				getAlphaSymbolMetadata([committedIntelligenceSymbol]),
				loadFeeds([committedIntelligenceSymbol]),
			]);
			if (cancelled) return;
			if (nextMetadata.status === "fulfilled") {
				setActiveMetadata(metadataBySymbol(nextMetadata.value));
			} else {
				notifyAlphaCreditWarning(nextMetadata.reason);
				setActiveMetadata({});
			}
			if (nextFeeds.status === "fulfilled") {
				setFeeds(nextFeeds.value);
			} else {
				notifyAlphaCreditWarning(nextFeeds.reason);
				setFeeds(emptyMarketIntelligenceFeeds());
				setSymbolError(parseActionError(nextFeeds.reason).message);
			}
			setIsLoadingSymbolFeed(false);
		})();

		return () => {
			cancelled = true;
		};
	}, [committedIntelligenceSymbol]);

	useEffect(() => {
		if (!committedSymbol || !committedInstrument) {
			setChartState({ error: "", isLoading: false, snapshot: null });
			return;
		}
		if (isLoadingBrokerConfig) {
			setChartState({ error: "", isLoading: true, snapshot: null });
			return;
		}
		if (!defaultBrokerAccount) {
			setChartState({
				error:
					brokerConfigError ||
					"No active default broker account is available for price data.",
				isLoading: false,
				snapshot: null,
			});
			return;
		}
		if (!defaultBrokerAccount.session_active) {
			setChartState({
				error:
					"The default broker session is not active. Activate it to load price data.",
				isLoading: false,
				snapshot: null,
			});
			return;
		}

		let cancelled = false;
		setChartState({ error: "", isLoading: true, snapshot: null });
		void (async () => {
			try {
				const snapshot = await getMarketChartData(
					defaultBrokerAccount.account_id,
					{
						instrument: committedInstrument,
						history_days: 90,
						daily_interval: "day",
						intraday_interval: "1minute",
						include_live_quote: true,
					},
				);
				if (cancelled) return;
				setChartState({
					error: snapshot.candles.length
						? ""
						: "No broker chart data returned for this symbol.",
					isLoading: false,
					snapshot,
				});
			} catch (caught) {
				if (cancelled) return;
				setChartState({
					error: parseActionError(caught).message,
					isLoading: false,
					snapshot: null,
				});
			}
		})();

		return () => {
			cancelled = true;
		};
	}, [
		brokerConfigError,
		committedInstrument,
		committedSymbol,
		defaultBrokerAccount,
		isLoadingBrokerConfig,
	]);

	function commitSymbol(
		symbol: string,
		instrument: InstrumentRef,
		intelligenceSymbol?: string,
	) {
		const normalized = symbol.trim().toUpperCase();
		if (!normalized) {
			setSymbolError("Enter a symbol to search market intelligence.");
			return;
		}
		const normalizedIntelligenceSymbol =
			intelligenceSymbol?.trim().toUpperCase() ||
			marketIntelligenceSymbolFromValue(normalized);
		setCommittedSymbol(normalized);
		setCommittedIntelligenceSymbol(normalizedIntelligenceSymbol);
		setCommittedInstrument({
			...instrument,
			symbol: instrument.symbol?.trim().toUpperCase() || normalized,
		});
		setSearchText(normalized);
		setShowSuggestions(false);
		setSymbolError("");
	}

	function submitSymbolSearch(event: FormEvent<HTMLFormElement>) {
		event.preventDefault();
		const query = searchText.trim().toUpperCase();
		const exactSuggestion = suggestions.find((row) => {
			const symbol = row.symbol.trim().toUpperCase();
			const tradingSymbol = row.trading_symbol?.trim().toUpperCase();
			return symbol === query || tradingSymbol === query;
		});
		if (exactSuggestion) {
			commitSymbol(
				exactSuggestion.symbol,
				instrumentFromSearch(exactSuggestion),
				marketIntelligenceSymbolFromSearch(exactSuggestion),
			);
			return;
		}
		commitSymbol(query, manualInstrument(query));
	}

	function clearSymbolSearch() {
		setSearchText("");
		setCommittedSymbol("");
		setCommittedIntelligenceSymbol("");
		setCommittedInstrument(null);
		setSuggestions([]);
		setSuggestionMetadata({});
		setShowSuggestions(false);
		setSymbolError("");
		setChartState({ error: "", isLoading: false, snapshot: null });
		if (selectedWatchlistId === ALL_WATCHLISTS_ID) {
			setFeeds(initialFeeds);
			setActiveMetadata(symbolMetadata);
		}
	}

	function handleFeedSymbolClick(symbol: string) {
		commitSymbol(symbol, manualInstrument(symbol));
	}

	return (
		<>
			<AlphaCreditWarningTrigger message={creditWarningMessage} />
			<PageHeader
				description={activeSection.description}
				title="Market Intelligence"
			/>

			<CardFrame className="relative z-10 mb-4 overflow-visible *:data-[slot=card]:overflow-visible *:data-[slot=card]:[clip-path:none]">
				<CardFrameHeader>
					<CardFrameTitle>Market feeds</CardFrameTitle>
					<CardFrameDescription>
						Switch product feeds and search a symbol chart
						{isLoadingBrokerConfig
							? ""
							: defaultBrokerAccount
								? ` · ${defaultAccountLabel(defaultBrokerAccount)}`
								: " · no default broker"}
						.
					</CardFrameDescription>
					<CardFrameAction>
						<Dialog>
							<DialogTrigger
								render={
									<Button
										aria-label="Learn about market intelligence"
										size="icon"
										type="button"
										variant="ghost"
									/>
								}
							>
								<Info aria-hidden="true" />
							</DialogTrigger>
							<DialogPopup className="max-w-xl">
								<DialogHeader>
									<DialogTitle>Understanding Market Intelligence</DialogTitle>
									<DialogDescription>
										How each Alpha product feed supports research and
										monitoring.
									</DialogDescription>
								</DialogHeader>
								<DialogPanel className="grid gap-4">
									{intelligenceHelpItems.map((item) => (
										<section className="grid gap-1" key={item.title}>
											<h3 className="text-sm font-semibold leading-5 text-foreground">
												{item.title}
											</h3>
											<p className="text-sm leading-6 text-muted-foreground">
												{item.body}
											</p>
										</section>
									))}
								</DialogPanel>
							</DialogPopup>
						</Dialog>
					</CardFrameAction>
				</CardFrameHeader>
				<Card className="overflow-visible">
					<CardPanel className="relative z-10 grid gap-3 overflow-visible p-4">
						<div className="flex min-w-0 flex-col gap-3 min-[960px]:flex-row min-[960px]:items-center min-[960px]:justify-between">
							<ToggleGroup
								aria-label="Market intelligence sections"
								className="flex-wrap"
								onValueChange={(next) => {
									if (next.length === 1) {
										setActiveSectionId(next[0] as AlphaSection);
									}
								}}
								size="sm"
								value={[activeSection.id]}
								variant="outline"
							>
								{marketIntelligenceSections.map((item) => {
									const Icon = sectionChrome[item.id].icon;
									return (
										<ToggleGroupItem
											aria-label={item.label}
											className="gap-1.5 px-3"
											key={item.id}
											value={item.id}
										>
											<Icon aria-hidden="true" />
											{item.label}
										</ToggleGroupItem>
									);
								})}
							</ToggleGroup>

							<form
								className="flex min-w-0 w-full flex-col gap-2 min-[640px]:flex-row min-[640px]:items-center min-[960px]:max-w-sm min-[960px]:flex-1"
								onSubmit={submitSymbolSearch}
							>
								<div className="relative min-w-0 flex-1" ref={searchAnchorRef}>
									<InputGroup className="h-9 w-full">
										<InputGroupAddon>
											<Search aria-hidden="true" />
										</InputGroupAddon>
										<InputGroupInput
											aria-autocomplete="list"
											aria-expanded={suggestionsOpen}
											aria-label="Search a symbol chart"
											autoComplete="off"
											onBlur={() =>
												window.setTimeout(() => setShowSuggestions(false), 120)
											}
											onChange={(event) => {
												setSearchText(event.target.value);
												setShowSuggestions(true);
											}}
											onFocus={() => {
												if (searchText.trim()) setShowSuggestions(true);
											}}
											placeholder="Search a symbol chart"
											role="combobox"
											value={searchText}
										/>
									</InputGroup>
								</div>
								<Group className="w-full shrink-0 min-[640px]:w-auto">
									<Button
										className="h-9"
										disabled={isLoadingSymbolFeed}
										type="submit"
									>
										<Search aria-hidden="true" />
										{isLoadingSymbolFeed ? "Loading..." : "Search"}
									</Button>
									{symbolModeActive ? (
										<Button
											className="h-9"
											onClick={clearSymbolSearch}
											type="button"
											variant="outline"
										>
											<X aria-hidden="true" />
											Clear
										</Button>
									) : null}
								</Group>
							</form>
						</div>
					</CardPanel>
				</Card>
			</CardFrame>

			{suggestionsOpen && suggestionMenuRect
				? createPortal(
						<div
							className="fixed z-[200] max-h-80 overflow-y-auto rounded-lg border border-border bg-popover shadow-lg ring-1 ring-black/20"
							role="listbox"
							style={{
								left: suggestionMenuRect.left,
								top: suggestionMenuRect.top,
								width: suggestionMenuRect.width,
							}}
						>
							{isLoadingSuggestions ? (
								<div className="px-3 py-2 text-sm text-muted-foreground">
									Searching...
								</div>
							) : null}
							{!isLoadingSuggestions && suggestions.length
								? suggestions.map((row) => {
										const intelligenceSymbol =
											marketIntelligenceSymbolFromSearch(row);
										const metadata = suggestionMetadata[intelligenceSymbol];
										const company = metadata?.company_name ?? row.name;
										const detail = [
											row.exchange,
											row.instrument_type,
											row.trading_symbol,
											metadata?.sector,
										].filter(Boolean);
										return (
											<button
												className="flex w-full min-w-0 items-center justify-between gap-3 border-b border-border px-3 py-2 text-left transition-colors last:border-b-0 hover:bg-accent"
												key={`${row.account_id ?? "default"}-${row.exchange ?? ""}-${row.symbol}-${row.trading_symbol ?? ""}`}
												onMouseDown={(event) => {
													event.preventDefault();
													commitSymbol(
														row.symbol,
														instrumentFromSearch(row),
														intelligenceSymbol,
													);
												}}
												role="option"
												type="button"
											>
												<span className="flex min-w-0 flex-1 items-center gap-3">
													<SymbolSearchLogo
														metadata={metadata}
														symbol={row.symbol}
													/>
													<span className="min-w-0">
														<span className="block truncate text-sm font-semibold text-foreground">
															{row.symbol}
															{company ? (
																<span className="font-normal text-muted-foreground">
																	{" "}
																	/ {company}
																</span>
															) : null}
														</span>
														<span className="block truncate text-xs text-muted-foreground">
															{detail.join(" / ") || "Broker instrument"}
														</span>
													</span>
												</span>
											</button>
										);
									})
								: null}
							{!isLoadingSuggestions && !suggestions.length ? (
								<div className="px-3 py-2 text-sm text-muted-foreground">
									Press search to use this symbol.
								</div>
							) : null}
						</div>,
						document.body,
					)
				: null}

			{symbolModeActive ? (
				<div className="mb-5">
					<MarketIntelligenceSymbolChart
						account={defaultBrokerAccount}
						feeds={feeds}
						instrument={committedInstrument}
						state={chartState}
						symbol={committedSymbol}
						symbolMetadata={chartMetadata}
					/>
				</div>
			) : null}

			{error ? <StateMessage message={error} tone="error" /> : null}
			{symbolError ? <StateMessage message={symbolError} tone="error" /> : null}
			{filterError ? <StateMessage message={filterError} tone="error" /> : null}
			{!error && !symbolModeActive && !symbols.length ? (
				<StateMessage message="Add symbols to a watchlist to view Alpha market intelligence." />
			) : null}
			{!error && visibleSymbols.length ? (
				<CardFrame>
					<CardFrameHeader>
						<CardFrameTitle>{activeSection.label}</CardFrameTitle>
						<CardFrameDescription>
							{activeSection.description}
							{symbolModeActive
								? " · Single symbol mode"
								: watchlistGroups.length
									? ` · ${activeSymbols.length} symbols`
									: ""}
							{isLoadingFilter ? " · Loading…" : ""}
							{!symbolModeActive &&
							watchlistGroups.length &&
							activeSymbols.length > ALPHA_SYMBOL_LIMIT
								? ` · first ${ALPHA_SYMBOL_LIMIT} for history`
								: ""}
						</CardFrameDescription>
						<CardFrameAction>
							{!symbolModeActive && watchlistGroups.length ? (
								<LiveStatusPill state={socketState} />
							) : null}
						</CardFrameAction>
					</CardFrameHeader>
					<Card>
						<CardPanel className="grid gap-4 p-4">
							{watchlistGroups.length ? (
								<div className="flex min-w-0 flex-col gap-2 min-[760px]:flex-row min-[760px]:items-center min-[760px]:justify-between">
									<WatchlistScopeTooltip
										historyLimit={ALPHA_SYMBOL_LIMIT}
										symbolCount={allSymbolsCount}
									>
										<SimpleSelect
											aria-label="Filter market intelligence by watchlist"
											disabled={isLoadingFilter || symbolModeActive}
											onValueChange={setSelectedWatchlistId}
											options={[
												{
													value: ALL_WATCHLISTS_ID,
													label: `All watchlists (${allSymbolsCount} symbols)`,
												},
												...watchlistGroups.map((group) => ({
													value: group.id,
													label: `${group.name} (${group.symbols.length} symbols)`,
												})),
											]}
											triggerClassName="h-9 min-w-[min(100%,16rem)]"
											value={selectedWatchlistId}
										/>
									</WatchlistScopeTooltip>
									<div className="min-w-0 w-full min-[760px]:max-w-sm min-[760px]:flex-1">
										<FeedSearchInput
											onChange={setFeedSearch}
											placeholder={
												symbolModeActive
													? `Filter ${committedIntelligenceSymbol || committedSymbol} feed`
													: `Filter ${filterLabel} feed`
											}
											value={feedSearch}
										/>
									</div>
								</div>
							) : null}
							<MarketIntelligenceLiveFeed
								activeSection={activeSection.id}
								enableLiveUpdates={!symbolModeActive}
								feedSearch={feedSearch}
								initialFeeds={feeds}
								onFeedSearchSymbol={handleFeedSymbolClick}
								onSocketStateChange={setSocketState}
								symbolMetadata={activeMetadata}
								symbols={visibleSymbols}
							/>
						</CardPanel>
					</Card>
				</CardFrame>
			) : null}
			{children}
		</>
	);
}

function SymbolSearchLogo({
	metadata,
	symbol,
}: {
	metadata?: AlphaSymbolMetadata;
	symbol: string;
}) {
	const [failed, setFailed] = useState(false);
	const logo = metadata?.logo && !failed ? metadata.logo : "";

	if (logo) {
		return (
			<img
				alt=""
				className="size-8 shrink-0 object-contain"
				loading="lazy"
				onError={() => setFailed(true)}
				referrerPolicy="no-referrer"
				src={logo}
			/>
		);
	}

	return (
		<span className="flex size-8 shrink-0 items-center justify-center bg-secondary font-mono text-[10px] font-semibold text-muted-foreground">
			{symbol.slice(0, 2).toUpperCase()}
		</span>
	);
}
