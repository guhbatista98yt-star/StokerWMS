import { useEffect, useState } from "react";
import { apiRequest } from "@/lib/queryClient";
import { renderLabelToHtml } from "@/lib/label-renderer";
import type { LabelContext, LabelTemplate } from "@shared/schema";

export function useLabelDefault(
  context: LabelContext,
  data: Record<string, unknown>,
) {
  const [loading, setLoading] = useState(true);
  const [templateHtml, setTemplateHtml] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await apiRequest("GET", `/api/print/label-template-resolve?context=${context}`);
        const json = (await res.json()) as { template: LabelTemplate | null };
        if (cancelled) return;
        if (!json.template) {
          setTemplateHtml(null);
          setLoading(false);
          return;
        }
        const html = await renderLabelToHtml(json.template, data);
        if (!cancelled) {
          setTemplateHtml(html);
          setLoading(false);
        }
      } catch {
        if (!cancelled) {
          setTemplateHtml(null);
          setLoading(false);
        }
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [context]);

  return { loading, templateHtml };
}
