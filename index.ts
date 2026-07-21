// AURÉA · Edge Function Supabase · pagamento marketplace (Stripe Connect)
// File: supabase/functions/create-checkout/index.ts
// Crea una sessione Stripe Checkout per gli articoli di UN venditore:
// i soldi vanno al venditore (destination charge) e Auréa trattiene la
// commissione (application fee). Se il venditore non ha ancora collegato
// il conto, l'incasso va alla piattaforma (Auréa) come pagamento semplice.
//
// Segreti richiesti:
//   STRIPE_SECRET_KEY, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
//   AUREA_FEE_PCT  (commissione %, es. "15"; modificabile quando vuoi)

import Stripe from "https://esm.sh/stripe@14?target=deno";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const stripe = new Stripe(Deno.env.get("STRIPE_SECRET_KEY") || "", {
  apiVersion: "2023-10-16",
  httpClient: Stripe.createFetchHttpClient(),
});

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const { items, order_id, seller_id, success_url, cancel_url } = await req.json();
    const line_items = (items || []).map((it: any) => ({
      price_data: {
        currency: "eur",
        product_data: { name: String(it.name || "Prodotto") },
        unit_amount: Math.round((Number(it.price) || 0) * 100),
      },
      quantity: Number(it.qty) || 1,
    }));
    if (!line_items.length) throw new Error("Carrello vuoto");

    // Commissioni Auréa (modificabili via variabili d'ambiente):
    //   AUREA_FEE_SUPPLIER = commissione % sui FORNITORI  (default 12)
    //   AUREA_FEE_PRO      = commissione % sui PROFESSIONISTI (default 10)
    const FEE_SUPPLIER = Number(Deno.env.get("AUREA_FEE_SUPPLIER") || "12");
    const FEE_PRO = Number(Deno.env.get("AUREA_FEE_PRO") || "10");

    const amountTotal = (items || []).reduce(
      (a: number, it: any) => a + Math.round((Number(it.price) || 0) * 100) * (Number(it.qty) || 1), 0);

    // conto Stripe del venditore (fornitore o professionista) + tipo per la commissione
    let destination: string | null = null;
    let isSupplier = false;
    if (seller_id) {
      const supabase = createClient(
        Deno.env.get("SUPABASE_URL") || "",
        Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "",
      );
      const { data } = await supabase
        .from("profiles").select("stripe_account_id, payouts_enabled, profession")
        .eq("id", seller_id).maybeSingle();
      if (data?.stripe_account_id && data?.payouts_enabled) destination = data.stripe_account_id;
      isSupplier = /fornitore/i.test(String(data?.profession || ""));
    }

    // 12% ai fornitori, 10% ai professionisti
    const FEE_PCT = isSupplier ? FEE_SUPPLIER : FEE_PRO;
    const fee = Math.max(0, Math.round(amountTotal * FEE_PCT / 100));

    const params: any = {
      mode: "payment",
      line_items,
      client_reference_id: order_id ? String(order_id) : undefined,
      metadata: order_id ? { order_id: String(order_id) } : {},
      success_url: success_url || "https://aureawellness.github.io/aurea/app.html",
      cancel_url: cancel_url || "https://aureawellness.github.io/aurea/app.html",
    };
    // se il venditore ha il conto attivo: paga lui, Auréa trattiene la commissione
    if (destination) {
      params.payment_intent_data = {
        application_fee_amount: fee,
        transfer_data: { destination },
      };
    }

    const session = await stripe.checkout.sessions.create(params);
    return new Response(JSON.stringify({ url: session.url }), {
      headers: { ...cors, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: String((e as Error).message || e) }), {
      status: 400, headers: { ...cors, "Content-Type": "application/json" },
    });
  }
});
