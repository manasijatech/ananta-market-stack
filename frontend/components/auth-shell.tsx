import Link from "next/link";
import { ThemeToggle } from "@/components/theme-toggle";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

type AuthShellProps = {
  title: string;
  eyebrow: string;
  subtitle: string;
  footerText: string;
  footerHref: string;
  footerAction: string;
  children: React.ReactNode;
};

export function AuthShell({
  title,
  eyebrow,
  subtitle,
  footerText,
  footerHref,
  footerAction,
  children
}: AuthShellProps) {
  return (
    <main className="grid min-h-screen grid-cols-1 lg:grid-cols-[minmax(0,1fr)_minmax(420px,520px)]">
      <section
        className="grid min-h-[360px] content-between bg-[linear-gradient(rgba(12,38,35,0.72),rgba(12,38,35,0.76)),url('https://images.unsplash.com/photo-1640340434855-6084b1f4901c?auto=format&fit=crop&w=1800&q=80')] bg-cover bg-center p-7 text-white lg:min-h-screen lg:p-12"
        aria-label="Market Stack"
      >
        <div className="flex items-center gap-3 text-[15px] font-extrabold">
          <div
            className="flex aspect-square w-10 shrink-0 items-center justify-center rounded-lg bg-primary text-[13px] font-black text-primary-foreground"
            aria-hidden="true"
          >
            MS
          </div>
          <span>Market Stack</span>
        </div>
        <div className="max-w-[720px]">
          <p className="mb-3.5 text-[13px] font-extrabold uppercase tracking-[0.08em] text-accent-soft">
            {eyebrow}
          </p>
          <h1 className="max-w-[860px] text-[38px] leading-[0.98] min-[560px]:text-[clamp(42px,5vw,76px)]">
            Broker access, account security, and trading workflows in one calm workspace.
          </h1>
        </div>
      </section>

      <section
        className="flex items-center justify-center bg-card p-0 min-[560px]:bg-transparent min-[560px]:p-6 lg:p-8"
        aria-label={title}
      >
        <div className="absolute right-5 top-5 z-10">
          <ThemeToggle />
        </div>
        <Card className="w-full max-w-[430px] shadow-none min-[560px]:shadow-auth">
          <CardHeader className="pb-0">
            <p className="mb-2 text-[13px] font-extrabold uppercase tracking-[0.08em] text-primary">
              {eyebrow}
            </p>
            <CardTitle className="text-[34px] leading-[1.08]">{title}</CardTitle>
            <CardDescription className="text-base">{subtitle}</CardDescription>
          </CardHeader>
          <CardContent>
            {children}
          <p className="mt-6 text-center text-sm text-muted-foreground">
            {footerText}{" "}
            <Link className="font-bold text-primary hover:underline" href={footerHref}>
              {footerAction}
            </Link>
          </p>
          </CardContent>
        </Card>
      </section>
    </main>
  );
}
