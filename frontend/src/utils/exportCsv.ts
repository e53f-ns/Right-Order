import Papa from 'papaparse';

const DEFAULT_FREE_LIMIT = 50;

export interface ExportCsvOptions {
  /** Tab name used in filename, e.g. 'cex-spreads' */
  tabName: string;
  /** Column headers */
  headers: string[];
  /** Row data — each row is an array of cell values matching headers order */
  rows: Array<Array<string | number | boolean | null | undefined>>;
  /** Row limit from plan (0 = unlimited). Falls back to isPro check. */
  rowLimit?: number;
  /** Legacy: Whether user has pro subscription (unlimited rows) */
  isPro?: boolean;
}

export interface ExportCsvResult {
  success: boolean;
  rowsExported: number;
  wasTruncated: boolean;
  error?: string;
}

/**
 * Export filtered table data to a CSV file and trigger browser download.
 * Row limit determined by plan (0 = unlimited), falls back to isPro → unlimited or 50.
 */
export function exportToCsv(options: ExportCsvOptions): ExportCsvResult {
  const { tabName, headers, rows, rowLimit, isPro = false } = options;

  if (rows.length === 0) {
    return { success: false, rowsExported: 0, wasTruncated: false, error: 'No data to export' };
  }

  try {
    const effectiveLimit = rowLimit !== undefined ? rowLimit : (isPro ? 0 : DEFAULT_FREE_LIMIT);
    const unlimited = effectiveLimit === 0;
    const wasTruncated = !unlimited && rows.length > effectiveLimit;
    const exportRows = unlimited ? rows : rows.slice(0, effectiveLimit);

    // Build array-of-objects for papaparse
    const data = exportRows.map(row => {
      const obj: Record<string, string | number | boolean | null | undefined> = {};
      headers.forEach((h, i) => {
        obj[h] = row[i];
      });
      return obj;
    });

    const csv = Papa.unparse(data, {
      quotes: true,
      delimiter: ',',
      header: true,
      newline: '\n',
    });

    // Generate filename: rightorder-[tabname]-export-[timestamp].csv
    const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const filename = `rightorder-${tabName}-export-${ts}.csv`;

    // Trigger download via Blob
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.style.display = 'none';
    document.body.appendChild(link);
    link.click();

    // Cleanup
    setTimeout(() => {
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    }, 100);

    return { success: true, rowsExported: exportRows.length, wasTruncated };
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'CSV export failed';
    console.error('[exportCsv] Error:', msg);
    return { success: false, rowsExported: 0, wasTruncated: false, error: msg };
  }
}
