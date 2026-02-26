import { Test, TestingModule } from '@nestjs/testing';
import { AlertsController } from '../controllers/alerts.controller';
import { WebhookDispatcherService } from '../services/webhook-dispatcher.service';
import { GasMonitorService } from '../services/gas-monitor.service';
import { SpikeClassifierService } from '../services/spike-classifier.service';
import { ThresholdEngineService } from '../services/threshold-engine.service';
import { Severity } from '../enums/severity.enum';
import { NotFoundException } from '@nestjs/common';

describe('AlertsController', () => {
  let controller: AlertsController;
  let dispatcher: WebhookDispatcherService;
  let monitor: GasMonitorService;
  let classifier: SpikeClassifierService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [AlertsController],
      providers: [
        WebhookDispatcherService,
        GasMonitorService,
        SpikeClassifierService,
        ThresholdEngineService,
      ],
    }).compile();

    controller = module.get<AlertsController>(AlertsController);
    dispatcher = module.get<WebhookDispatcherService>(WebhookDispatcherService);
    monitor = module.get<GasMonitorService>(GasMonitorService);
    classifier = module.get<SpikeClassifierService>(SpikeClassifierService);

    // Prevent monitoring loop
    monitor.stop();
  });

  afterEach(() => {
    monitor.stop();
  });

  // ─── POST /alerts/webhook ────────────────────────────────────────

  describe('registerWebhook', () => {
    it('should register and return subscription', () => {
      const result = controller.registerWebhook({ url: 'http://example.com/hook' });
      expect(result.subscription.url).toBe('http://example.com/hook');
      expect(result.subscription.id).toBeDefined();
      expect(result.subscription.secret).toBeDefined();
    });

    it('should include one-time secret reminder', () => {
      const result = controller.registerWebhook({ url: 'http://example.com/hook' });
      expect(result.message).toMatch(/secret/i);
    });
  });

  // ─── GET /alerts/webhook ────────────────────────────────────────

  describe('listWebhooks', () => {
    it('should return empty list initially', () => {
      expect(controller.listWebhooks().subscriptions).toHaveLength(0);
    });

    it('should return registered webhooks with redacted secrets', () => {
      dispatcher.register({ url: 'http://example.com/hook' });
      const { subscriptions } = controller.listWebhooks();
      expect(subscriptions).toHaveLength(1);
      expect(subscriptions[0].secret).toBe('***redacted***');
    });
  });

  // ─── GET /alerts/webhook/:id ────────────────────────────────────

  describe('getWebhook', () => {
    it('should return subscription with redacted secret', () => {
      const sub = dispatcher.register({ url: 'http://example.com/hook' });
      const result = controller.getWebhook(sub.id);
      expect(result.id).toBe(sub.id);
      expect(result.secret).toBe('***redacted***');
    });

    it('should throw NotFoundException for unknown id', () => {
      expect(() => controller.getWebhook('ghost')).toThrow(NotFoundException);
    });
  });

  // ─── PATCH /alerts/webhook/:id ──────────────────────────────────

  describe('updateWebhook', () => {
    it('should update webhook and return with redacted secret', () => {
      const sub = dispatcher.register({ url: 'http://old.com' });
      const result = controller.updateWebhook(sub.id, { url: 'http://new.com' });
      expect(result.url).toBe('http://new.com');
      expect(result.secret).toBe('***redacted***');
    });

    it('should throw NotFoundException for unknown id', () => {
      expect(() =>
        controller.updateWebhook('ghost', { active: false }),
      ).toThrow(NotFoundException);
    });
  });

  // ─── DELETE /alerts/webhook/:id ─────────────────────────────────

  describe('deleteWebhook', () => {
    it('should remove the subscription', () => {
      const sub = dispatcher.register({ url: 'http://example.com/hook' });
      controller.deleteWebhook(sub.id);
      expect(() => dispatcher.findById(sub.id)).toThrow(NotFoundException);
    });

    it('should throw for non-existent webhook', () => {
      expect(() => controller.deleteWebhook('ghost')).toThrow(NotFoundException);
    });
  });

  // ─── GET /alerts/chains ─────────────────────────────────────────

  describe('getTrackedChains', () => {
    it('should return default chain 1', () => {
      expect(controller.getTrackedChains().chains).toContain(1);
    });
  });

  // ─── POST /alerts/chains/:chainId ───────────────────────────────

  describe('trackChain', () => {
    it('should add chain to tracking', () => {
      controller.trackChain('137');
      expect(monitor.getTrackedChains()).toContain(137);
    });
  });

  // ─── DELETE /alerts/chains/:chainId ─────────────────────────────

  describe('untrackChain', () => {
    it('should remove chain from tracking', () => {
      controller.untrackChain('1');
      expect(monitor.getTrackedChains()).not.toContain(1);
    });
  });

  // ─── POST /alerts/trigger/:chainId ──────────────────────────────

  describe('triggerManualCheck', () => {
    it('should call tick and return null alert if no spike', async () => {
      const tickSpy = jest
        .spyOn(monitor, 'tick')
        .mockResolvedValue(undefined);

      const result = await controller.triggerManualCheck('1');
      expect(tickSpy).toHaveBeenCalledTimes(1);
      expect(result.message).toMatch(/chain 1/i);
    });
  });

  // ─── GET /alerts/status/:chainId ────────────────────────────────

  describe('getChainStatus', () => {
    it('should return null alert and 0 history for fresh chain', () => {
      const status = controller.getChainStatus('1');
      expect(status.lastAlert).toBeNull();
      expect(status.historyPoints).toBe(0);
      expect(status.latestSnapshot).toBeNull();
    });

    it('should return history points when snapshots exist', () => {
      classifier.addSnapshot({ chainId: 1, baseFeeGwei: 20, priorityFeeGwei: 2, timestamp: 1700000000 });
      const status = controller.getChainStatus('1');
      expect(status.historyPoints).toBe(1);
      expect(status.latestSnapshot).toBeDefined();
    });
  });

  // ─── PUT /alerts/config ─────────────────────────────────────────

  describe('setConfig', () => {
    it('should update global threshold config', () => {
      const result = controller.setConfig({ baseFeePercentageCritical: 60 });
      expect(result.config.baseFeePercentageCritical).toBe(60);
      expect(result.message).toMatch(/globally/i);
    });

    it('should mention chain when chainId is provided', () => {
      const result = controller.setConfig({ chainId: 1, baseFeePercentageCritical: 60 });
      expect(result.message).toMatch(/chain 1/i);
    });
  });
});
