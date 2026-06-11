import { AnimatedCounter } from "./AnimatedCounter";

export function BalanceDisplay({ balance }: { balance: number }) {
  const bankrupt = balance < 0;
  return (
    <div>
      <div
        className={`text-4xl font-semibold tracking-tight md:text-5xl ${
          bankrupt ? "text-destructive" : "text-foreground"
        }`}
      >
        <AnimatedCounter value={Math.abs(balance)} currency />
      </div>
      {bankrupt && (
        <span className="chip mt-2 bg-destructive/15 text-destructive">BANKRUPT</span>
      )}
    </div>
  );
}
