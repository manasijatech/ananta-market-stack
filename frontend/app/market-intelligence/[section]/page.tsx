import { notFound } from "next/navigation";
import { MarketIntelligenceResult, marketIntelligenceSections } from "@/components/market-intelligence/market-intelligence-page";

type MarketIntelligenceSectionPageProps = {
 params: Promise<{ section: string }>;
};

export function generateStaticParams() {
 return marketIntelligenceSections.map((item) => ({ section: item.id }));
}

export default async function MarketIntelligenceSectionPage({ params }: MarketIntelligenceSectionPageProps) {
 const { section } = await params;
 const activeSection = marketIntelligenceSections.find((item) => item.id === section);

 if (!activeSection) {
 notFound();
 }

 return <MarketIntelligenceResult section={activeSection.id} />;
}
