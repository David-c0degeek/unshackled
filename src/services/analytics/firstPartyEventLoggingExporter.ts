import { type ExportResult, ExportResultCode } from '@opentelemetry/core'
import type {
  LogRecordExporter,
  ReadableLogRecord,
} from '@opentelemetry/sdk-logs'

/**
 * Stub exporter for 1st-party event logging.
 * All methods are no-ops — no telemetry is collected or sent.
 */
export class FirstPartyEventLoggingExporter implements LogRecordExporter {
  constructor() {
    // No-op: don't retry previous batches in OSS build
  }

  async export(
    records: ReadableLogRecord[],
    callback: (result: ExportResult) => void,
  ): Promise<void> {
    callback({ code: ExportResultCode.SUCCESS })
  }

  async shutdown(): Promise<void> {
    // No-op
  }

  async destroy(): Promise<void> {
    // No-op
  }
}
