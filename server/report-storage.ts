import type { Report, Recommendation } from "../shared/types";
import { getServerSupabase } from "./supabase";
import { databaseError } from "./database-errors";

export type SavedReport = { report: Report; recommendations: Recommendation[] };
export async function findSavedReport(
  sub: string,
  fingerprint: string,
): Promise<SavedReport | null> {
  const { data, error } = await getServerSupabase()
    .from("ai_reports")
    .select("report,recommendations")
    .eq("auth0_sub", sub)
    .eq("input_fingerprint", fingerprint)
    .in("status", ["complete", "empty"])
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw databaseError(error);
  return data
    ? { report: data.report, recommendations: data.recommendations }
    : null;
}
export async function saveReport(sub: string, saved: SavedReport) {
  const report = saved.report;
  const { error } = await getServerSupabase().from("ai_reports").upsert(
    {
      id: report.id,
      auth0_sub: sub,
      frequency: report.frequency,
      period_start: report.since,
      period_end: report.until,
      report,
      recommendations: saved.recommendations,
      model: report.model,
      prompt_version: report.promptVersion,
      input_fingerprint: report.inputFingerprint,
      status: report.status,
      created_at: report.at,
    },
    { onConflict: "auth0_sub,input_fingerprint,status" },
  );
  if (error) throw databaseError(error);
}
