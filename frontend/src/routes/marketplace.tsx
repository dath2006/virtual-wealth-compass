import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { motion, AnimatePresence } from "framer-motion";
import { ShoppingBag, Landmark, ArrowRight, ShieldAlert, Sparkles } from "lucide-react";

import { PageLayout } from "@/components/layout/PageLayout";
import {
  getMarketplaceCatalogue,
  getMyPasses,
  purchasePass,
  activatePass,
  cancelPass,
  endPassEarly,
  getSettings,
  getStreak,
} from "@/lib/dataService";
import { CataloguePassCard, PurchasedPassCard } from "@/components/ui/PassCard";
import { Modal } from "@/components/ui/Modal";
import { fmtINR } from "@/lib/formatters";
import { useToast } from "@/lib/toast";
import type { MarketplacePass } from "@/lib/types";

export const Route = createFileRoute("/marketplace")({
  head: () => ({
    meta: [
      { title: "Marketplace · Productivity Economy" },
      { name: "description", content: "Spend virtual ₹ to buy time, activity, and cooldown passes." },
    ],
  }),
  component: MarketplacePage,
});

type TabType = "TIME" | "ACTIVITY" | "COOLDOWN" | "MY_PASSES";

function MarketplacePage() {
  const [activeTab, setActiveTab] = useState<TabType>("TIME");
  const [purchaseTarget, setPurchaseTarget] = useState<MarketplacePass | null>(null);
  const [purchaseNotes, setPurchaseNotes] = useState("");
  
  const qc = useQueryClient();
  const { toast } = useToast();

  // Queries
  const catalogueQ = useQuery({
    queryKey: ["marketplace_catalogue"],
    queryFn: getMarketplaceCatalogue,
  });
  
  const myPassesQ = useQuery({
    queryKey: ["my_passes"],
    queryFn: getMyPasses,
  });

  const settingsQ = useQuery({
    queryKey: ["settings"],
    queryFn: getSettings,
  });

  const streakQ = useQuery({
    queryKey: ["streak"],
    queryFn: getStreak,
  });

  const streak = streakQ.data ?? 0;
  const catalogueData = catalogueQ.data;
  const myPasses = myPassesQ.data ?? [];
  const settings = settingsQ.data;

  // Mutations
  const buyMutation = useMutation({
    mutationFn: ({ passType, notes }: { passType: string; notes?: string }) =>
      purchasePass(passType as any, notes),
    onSuccess: (data) => {
      const guiltTax = data.guilt_tax > 0 ? ` (+${fmtINR(data.guilt_tax)} guilt tax)` : "";
      toast(`${data.message ?? `Purchased!`}${guiltTax} New balance: ${fmtINR(data.new_balance)}`);
      setPurchaseTarget(null);
      setPurchaseNotes("");
      qc.invalidateQueries({ queryKey: ["marketplace_catalogue"] });
      qc.invalidateQueries({ queryKey: ["my_passes"] });
      qc.invalidateQueries({ queryKey: ["balance"] });
      qc.invalidateQueries({ queryKey: ["ledger"] });
    },
    onError: (err: any) => {
      toast(`Purchase failed: ${err.message || err}`);
    },
  });

  const activateMutation = useMutation({
    mutationFn: activatePass,
    onSuccess: (data) => {
      toast(`Activated: ${data.pass_type}! Enjoy.`);
      qc.invalidateQueries({ queryKey: ["my_passes"] });
      qc.invalidateQueries({ queryKey: ["marketplace_catalogue"] });
    },
    onError: (err: any) => {
      toast(`Activation failed: ${err.message || err}`);
    },
  });

  const cancelMutation = useMutation({
    mutationFn: cancelPass,
    onSuccess: (data) => {
      toast(data.message);
      qc.invalidateQueries({ queryKey: ["my_passes"] });
      qc.invalidateQueries({ queryKey: ["marketplace_catalogue"] });
      qc.invalidateQueries({ queryKey: ["balance"] });
      qc.invalidateQueries({ queryKey: ["ledger"] });
    },
    onError: (err: any) => {
      toast(`Cancel failed: ${err.message || err}`);
    },
  });

  const endEarlyMutation = useMutation({
    mutationFn: endPassEarly,
    onSuccess: (data) => {
      toast(data.message);
      qc.invalidateQueries({ queryKey: ["my_passes"] });
      qc.invalidateQueries({ queryKey: ["marketplace_catalogue"] });
    },
    onError: (err: any) => {
      toast(`Failed to end pass early: ${err.message || err}`);
    },
  });

  // Filters for tabs
  const filteredCatalogue = catalogueData?.passes.filter(
    (p) => p.category === activeTab
  ) ?? [];

  const handleBuyClick = (pass: MarketplacePass) => {
    setPurchaseTarget(pass);
    setPurchaseNotes("");
  };

  const confirmPurchase = () => {
    if (!purchaseTarget) return;
    buyMutation.mutate({
      passType: purchaseTarget.pass_type,
      notes: purchaseNotes.trim() || undefined,
    });
  };

  const isLoading = catalogueQ.isLoading || myPassesQ.isLoading;

  return (
    <PageLayout
      title="Leisure Marketplace"
      subtitle="Invest your hard-earned virtual ₹ into guilt-free passes. Buy now, start whenever you need."
    >
      {/* Header Cards: Balance & Spend Cap */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 mb-6">
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="glass relative overflow-hidden rounded-3xl p-5"
        >
          <div className="absolute top-0 right-0 p-4 opacity-10">
            <ShoppingBag className="size-16" />
          </div>
          <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
            Available Balance
          </div>
          <div className="mt-1 text-3xl font-bold text-foreground">
            {fmtINR(catalogueData?.current_balance ?? 0)}
          </div>
          <div className="mt-2 text-[11px] text-muted-foreground">
            Earn more by keeping focus sessions active.
          </div>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.05 }}
          className="glass relative overflow-hidden rounded-3xl p-5"
        >
          <div className="absolute top-0 right-0 p-4 opacity-10">
            <Landmark className="size-16" />
          </div>
          <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
            Monthly Spend Cap
          </div>
          <div className="mt-1 text-3xl font-bold text-foreground">
            {fmtINR(catalogueData?.monthly_marketplace_spent ?? 0)}
            <span className="text-sm font-normal text-muted-foreground">
              {" "}
              / {fmtINR(catalogueData?.monthly_marketplace_cap ?? 1500)}
            </span>
          </div>
          {/* Progress bar */}
          <div className="mt-3.5 h-1.5 w-full rounded-full bg-white/30 overflow-hidden">
            <div
              className="h-full bg-primary transition-all duration-500"
              style={{
                width: `${Math.min(
                  100,
                  ((catalogueData?.monthly_marketplace_spent ?? 0) /
                    (catalogueData?.monthly_marketplace_cap ?? 1500)) *
                    100
                )}%`,
              }}
            />
          </div>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
          className="glass relative overflow-hidden rounded-3xl p-5 sm:col-span-2 lg:col-span-1"
        >
          <div className="absolute top-0 right-0 p-4 opacity-10">
            <Sparkles className="size-16 text-primary" />
          </div>
          <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
            Streak Level
          </div>
          <div className="mt-1 text-3xl font-bold text-primary flex items-baseline gap-1">
            {streak}
            <span className="text-sm font-semibold text-muted-foreground"> days</span>
          </div>
          <div className="mt-2 text-[11px] text-muted-foreground">
            Higher streaks unlock premium passes like Weekend Mode.
          </div>
        </motion.div>
      </div>

      {/* Navigation Tabs */}
      <div className="flex border-b border-white/20 pb-px mb-6 overflow-x-auto no-scrollbar scroll-smooth">
        {(["TIME", "ACTIVITY", "COOLDOWN", "MY_PASSES"] as const).map((tab) => {
          const active = activeTab === tab;
          let label = tab === "MY_PASSES" ? "My Passes" : `${tab.toLowerCase()} passes`;
          if (tab === "MY_PASSES" && myPasses.length > 0) {
            const activeCount = myPasses.filter((p) => p.status === "ACTIVE").length;
            const queuedCount = myPasses.filter((p) => p.status === "PURCHASED").length;
            
            if (activeCount > 0) {
              label += ` (${activeCount} Active)`;
            } else if (queuedCount > 0) {
              label += ` (${queuedCount})`;
            }
          }

          return (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`relative pb-3 px-4 text-xs font-semibold uppercase tracking-wider transition-colors ${
                active ? "text-primary" : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {label}
              {active && (
                <motion.div
                  layoutId="marketplace-tab-line"
                  className="absolute bottom-0 inset-x-0 h-0.5 bg-primary"
                  transition={{ type: "spring", stiffness: 300, damping: 30 }}
                />
              )}
            </button>
          );
        })}
      </div>

      {/* Tab Content */}
      <AnimatePresence mode="wait">
        <motion.div
          key={activeTab}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -8 }}
          transition={{ duration: 0.15 }}
          className="min-h-[400px]"
        >
          {isLoading ? (
            <div className="flex flex-col items-center justify-center py-20 gap-3 text-muted-foreground">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
              <span className="text-xs font-medium">Syncing catalogue...</span>
            </div>
          ) : activeTab === "MY_PASSES" ? (
            myPasses.length === 0 ? (
              <div className="glass flex flex-col items-center justify-center rounded-3xl p-16 text-center">
                <ShoppingBag className="size-10 text-muted-foreground opacity-50 mb-3" />
                <h3 className="text-base font-semibold text-foreground">No passes bought yet</h3>
                <p className="mt-1 text-xs text-muted-foreground max-w-sm">
                  Your purchased passes will show up here. Browse the Time, Activity, or Cooldown tabs to get started!
                </p>
              </div>
            ) : (
              <div className="space-y-8">
                {/* Active Passes Section */}
                {myPasses.some((p) => p.status === "ACTIVE") && (
                  <div>
                    <h3 className="text-xs font-bold uppercase tracking-wider text-primary mb-3">
                      Currently Active
                    </h3>
                    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                      {myPasses
                        .filter((p) => p.status === "ACTIVE")
                        .map((p) => (
                          <PurchasedPassCard
                            key={p.id}
                            purchased={p}
                            catalogue={catalogueData?.passes ?? []}
                            settings={settings}
                            onEndEarly={(id) => endEarlyMutation.mutate(id)}
                            onTimerComplete={() => qc.invalidateQueries({ queryKey: ["my_passes"] })}
                          />
                        ))}
                    </div>
                  </div>
                )}

                {/* Queued Passes Section */}
                {myPasses.some((p) => p.status === "PURCHASED") && (
                  <div>
                    <h3 className="text-xs font-bold uppercase tracking-wider text-foreground/70 mb-3">
                      Queued Passes
                    </h3>
                    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                      {myPasses
                        .filter((p) => p.status === "PURCHASED")
                        .map((p) => (
                          <PurchasedPassCard
                            key={p.id}
                            purchased={p}
                            catalogue={catalogueData?.passes ?? []}
                            settings={settings}
                            onActivate={(id) => activateMutation.mutate(id)}
                            onCancel={(id) => cancelMutation.mutate(id)}
                          />
                        ))}
                    </div>
                  </div>
                )}

                {/* History Section */}
                {myPasses.some((p) => p.status !== "ACTIVE" && p.status !== "PURCHASED") && (
                  <div>
                    <h3 className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-3">
                      Past History
                    </h3>
                    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                      {myPasses
                        .filter((p) => p.status !== "ACTIVE" && p.status !== "PURCHASED")
                        .map((p) => (
                          <PurchasedPassCard
                            key={p.id}
                            purchased={p}
                            catalogue={catalogueData?.passes ?? []}
                          />
                        ))}
                    </div>
                  </div>
                )}
              </div>
            )
          ) : filteredCatalogue.length === 0 ? (
            <div className="glass flex flex-col items-center justify-center rounded-3xl p-16 text-center">
              <ShoppingBag className="size-10 text-muted-foreground opacity-50 mb-3" />
              <h3 className="text-base font-semibold text-foreground">No passes in this category</h3>
            </div>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {filteredCatalogue.map((p) => (
                <CataloguePassCard
                  key={p.pass_type}
                  pass={p}
                  currentStreak={streak}
                  currentBalance={catalogueData?.current_balance ?? 0}
                  onBuy={handleBuyClick}
                />
              ))}
            </div>
          )}
        </motion.div>
      </AnimatePresence>

      {/* CONFIRMATION / GUILT TAX MODAL */}
      <Modal
        open={purchaseTarget !== null}
        onClose={() => setPurchaseTarget(null)}
        title={purchaseTarget?.guilt_tax_amount ? "Guilt Tax Applied ⚠️" : "Confirm Purchase"}
      >
        {purchaseTarget && (
          <div className="space-y-4">
            {purchaseTarget.guilt_tax_amount > 0 ? (
              <div className="rounded-2xl bg-amber-500/10 p-4 border border-amber-500/20 text-xs text-amber-700 leading-normal flex items-start gap-3">
                <ShieldAlert className="size-5 shrink-0 mt-0.5 text-amber-600" />
                <div>
                  <h4 className="font-semibold text-amber-800 text-sm mb-1">Retroactive Guilt Tax</h4>
                  You already watched videos or used distraction apps today without a pass. The economy imposes a +20% guilt tax for buying leisure retroactively.
                </div>
              </div>
            ) : (
              <p className="text-xs text-muted-foreground leading-relaxed">
                You are about to purchase the <strong>{purchaseTarget.display_name}</strong>. The virtual ₹ amount will be deducted immediately.
              </p>
            )}

            {/* Price breakdown */}
            <div className="rounded-2xl bg-white/50 p-4 border border-white/60 space-y-2">
              <div className="flex justify-between text-xs text-muted-foreground">
                <span>Base Price:</span>
                <span>{fmtINR(purchaseTarget.virtual_price)}</span>
              </div>
              
              {purchaseTarget.guilt_tax_amount > 0 && (
                <div className="flex justify-between text-xs text-amber-600 font-medium">
                  <span>Guilt Tax (+20%):</span>
                  <span>+{fmtINR(purchaseTarget.guilt_tax_amount)}</span>
                </div>
              )}
              
              <div className="h-px bg-white/80 my-1" />
              
              <div className="flex justify-between text-sm font-bold text-foreground">
                <span>Total Cost:</span>
                <span className={purchaseTarget.guilt_tax_amount > 0 ? "text-amber-600" : "text-foreground"}>
                  {fmtINR(purchaseTarget.total_price)}
                </span>
              </div>
            </div>

            {/* Notes Input */}
            <div>
              <label htmlFor="notes" className="block text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1">
                Optional Notes
              </label>
              <input
                id="notes"
                type="text"
                value={purchaseNotes}
                onChange={(e) => setPurchaseNotes(e.target.value)}
                placeholder="e.g. 'watching Interstellar', 'weekend outing tag'"
                className="w-full bg-white/60 border border-white/80 focus:border-primary/50 focus:bg-white rounded-xl px-3 py-2 text-xs text-foreground outline-hidden transition"
              />
            </div>

            {/* Actions */}
            <div className="flex gap-3 pt-2">
              <button
                onClick={() => setPurchaseTarget(null)}
                className="flex-1 py-2 rounded-xl text-xs font-semibold bg-white/50 text-foreground border border-white/80 hover:bg-white transition"
              >
                Cancel
              </button>
              
              <button
                onClick={confirmPurchase}
                disabled={buyMutation.isPending}
                className={`flex-1 py-2 rounded-xl text-xs font-semibold text-white flex items-center justify-center gap-1.5 transition active:scale-95 ${
                  purchaseTarget.guilt_tax_amount > 0
                    ? "bg-amber-500 hover:bg-amber-600"
                    : "bg-primary hover:opacity-90"
                }`}
              >
                {buyMutation.isPending ? (
                  <div className="animate-spin rounded-full size-3.5 border-b-2 border-white" />
                ) : (
                  <>
                    <span>Confirm & Pay</span>
                    <ArrowRight className="size-3.5" />
                  </>
                )}
              </button>
            </div>
          </div>
        )}
      </Modal>
    </PageLayout>
  );
}
