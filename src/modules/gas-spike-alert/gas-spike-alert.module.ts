import { Module } from '@nestjs/common';
import { AlertsController } from './controllers/alerts.controller';
import { GasMonitorService } from './services/gas-monitor.service';
import { SpikeClassifierService } from './services/spike-classifier.service';
import { ThresholdEngineService } from './services/threshold-engine.service';
import { WebhookDispatcherService } from './services/webhook-dispatcher.service';

/**
 * GasSpikeAlertModule
 * ───────────────────
 * Self-contained module providing:
 *
 *  • Continuous gas price monitoring across multiple chains
 *  • Configurable threshold evaluation (%, absolute, volatility, priority fee)
 *  • Severity-based spike classification (Info / Warning / Critical)
 *  • Webhook fan-out with HMAC-signed payloads and retry back-off
 *  • REST endpoints for webhook management and threshold configuration
 *
 * Usage in AppModule:
 *
 *   @Module({ imports: [GasSpikeAlertModule] })
 *   export class AppModule {}
 */
@Module({
  controllers: [AlertsController],
  providers: [
    GasMonitorService,
    SpikeClassifierService,
    ThresholdEngineService,
    WebhookDispatcherService,
  ],
  exports: [
    GasMonitorService,
    SpikeClassifierService,
    ThresholdEngineService,
    WebhookDispatcherService,
  ],
})
export class GasSpikeAlertModule {}
