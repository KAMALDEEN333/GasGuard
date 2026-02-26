import { Test, TestingModule } from '@nestjs/testing';
import { GasMonitorService } from '../services/gas-monitor.service';
import { SpikeClassifierService } from '../services/spike-classifier.service';
import { ThresholdEngineService } from '../services/threshold-engine.service';
import { WebhookDispatcherService } from '../services/webhook-dispatcher.service';
import { Severity } from '../enums/severity.enum';
import { GasSnapshot } from '../interfaces/gas-spike.interface';

const makeSnapshot = (
  chainId: number,
  baseFeeGwei: number,
  priorityFeeGwei = 2,
): GasSnapshot => ({
  chainId,
  baseFeeGwei,
  priorityFeeGwei,
  timestamp: Math.floor(Date.now() / 1000),
});

describe('GasMonitorService', () => {
  let monitor: GasMonitorService;
  let dispatcher: WebhookDispatcherService;
  let classifier: SpikeClassifierService;
  let dispatchAllSpy: jest.SpyInstance;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        GasMonitorService,
        SpikeClassifierService,
        ThresholdEngineService,
        WebhookDispatcherService,
      ],
    }).compile();

    // Prevent onModuleInit from starting the interval in tests
    monitor = module.get<GasMonitorService>(GasMonitorService);
    monitor.stop();

    dispatcher = module.get<WebhookDispatcherService>(WebhookDispatcherService);
    classifier = module.get<SpikeClassifierService>(SpikeClassifierService);

    dispatchAllSpy = jest
      .spyOn(dispatcher, 'dispatchAll')
      .mockResolvedValue(undefined);
  });

  afterEach(() => {
    monitor.stop();
    jest.clearAllMocks();
  });

  // ─── chain tracking ─────────────────────────────────────────────

  describe('chain tracking', () => {
    it('should track chain 1 by default', () => {
      expect(monitor.getTrackedChains()).toContain(1);
    });

    it('should add a chain via trackChain', () => {
      monitor.trackChain(137);
      expect(monitor.getTrackedChains()).toContain(137);
    });

    it('should remove a chain via untrackChain', () => {
      monitor.untrackChain(1);
      expect(monitor.getTrackedChains()).not.toContain(1);
    });
  });

  // ─── tick with no spike ─────────────────────────────────────────

  describe('tick — no spike', () => {
    it('should not dispatch when gas is stable', async () => {
      monitor.setGasFetcher(async (chainId) => makeSnapshot(chainId, 20));
      // Seed stable history
      for (let i = 0; i < 5; i++) {
        classifier.addSnapshot(makeSnapshot(1, 20));
      }

      await monitor.tick();
      expect(dispatchAllSpy).not.toHaveBeenCalled();
    });
  });

  // ─── tick with spike ────────────────────────────────────────────

  describe('tick — spike detected', () => {
    it('should dispatch CRITICAL alert when base fee jumps 50%', async () => {
      // Seed stable history at 40 gwei
      for (let i = 0; i < 5; i++) {
        classifier.addSnapshot(makeSnapshot(1, 40));
      }

      monitor.setGasFetcher(async (chainId) => makeSnapshot(chainId, 65, 2)); // 62.5% increase
      await monitor.tick();

      expect(dispatchAllSpy).toHaveBeenCalledTimes(1);
      const payload = dispatchAllSpy.mock.calls[0][0];
      expect(payload.severity).toBe(Severity.CRITICAL);
      expect(payload.chainId).toBe(1);
    });

    it('should include correct gwei strings in payload', async () => {
      classifier.addSnapshot(makeSnapshot(1, 32));
      monitor.setGasFetcher(async (chainId) => makeSnapshot(chainId, 75, 2));
      await monitor.tick();

      const payload = dispatchAllSpy.mock.calls[0][0];
      expect(payload.previousBaseFee).toMatch(/gwei/);
      expect(payload.currentBaseFee).toMatch(/gwei/);
    });

    it('should set timestamp in payload', async () => {
      classifier.addSnapshot(makeSnapshot(1, 32));
      monitor.setGasFetcher(async (chainId) => makeSnapshot(chainId, 75, 2));
      await monitor.tick();

      const payload = dispatchAllSpy.mock.calls[0][0];
      expect(payload.timestamp).toBeGreaterThan(0);
    });

    it('should store last alert via getLastAlert', async () => {
      classifier.addSnapshot(makeSnapshot(1, 32));
      monitor.setGasFetcher(async (chainId) => makeSnapshot(chainId, 75, 2));
      await monitor.tick();

      const lastAlert = monitor.getLastAlert(1);
      expect(lastAlert).toBeDefined();
      expect(lastAlert!.chainId).toBe(1);
    });
  });

  // ─── multi-chain tick ───────────────────────────────────────────

  describe('multi-chain tick', () => {
    it('should process all tracked chains', async () => {
      monitor.trackChain(137);
      monitor.trackChain(42161);

      const fetched: number[] = [];
      monitor.setGasFetcher(async (chainId) => {
        fetched.push(chainId);
        return makeSnapshot(chainId, 20);
      });

      await monitor.tick();
      expect(fetched).toContain(1);
      expect(fetched).toContain(137);
      expect(fetched).toContain(42161);
    });

    it('should dispatch alerts for each spiking chain independently', async () => {
      monitor.trackChain(137);

      // Seed history for both chains
      classifier.addSnapshot(makeSnapshot(1, 30));
      classifier.addSnapshot(makeSnapshot(137, 30));

      monitor.setGasFetcher(async (chainId) =>
        makeSnapshot(chainId, 60, 2), // 100% increase for both
      );

      await monitor.tick();
      const calledChains = dispatchAllSpy.mock.calls.map((c) => c[0].chainId);
      expect(calledChains).toContain(1);
      expect(calledChains).toContain(137);
    });
  });

  // ─── setGasFetcher ──────────────────────────────────────────────

  describe('setGasFetcher', () => {
    it('should use the custom fetcher', async () => {
      const fetcher = jest.fn().mockResolvedValue(makeSnapshot(1, 20));
      monitor.setGasFetcher(fetcher);
      await monitor.tick();
      expect(fetcher).toHaveBeenCalledWith(1);
    });
  });

  // ─── buildAlertPayload ──────────────────────────────────────────

  describe('buildAlertPayload', () => {
    it('should format gwei strings correctly', () => {
      const enriched = {
        chainId: 1,
        baseFeeGwei: 75.123,
        priorityFeeGwei: 2.5,
        timestamp: 1700000000,
        movingAverageBaseFee: 35,
        movingAveragePriorityFee: 2,
        volatilityIndex: 0.3,
        baseFeePercentageChange: 134,
        priorityFeePercentageChange: 25,
      };

      const payload = monitor.buildAlertPayload(
        enriched,
        32,
        1,
        Severity.CRITICAL,
        [],
      );

      expect(payload.currentBaseFee).toBe('75.12 gwei');
      expect(payload.previousBaseFee).toBe('32.00 gwei');
      expect(payload.percentageIncrease).toBe(134);
    });

    it('should include recommendation based on severity', () => {
      const enriched = {
        chainId: 1,
        baseFeeGwei: 50,
        priorityFeeGwei: 2,
        timestamp: 1700000000,
        movingAverageBaseFee: 40,
        movingAveragePriorityFee: 2,
        volatilityIndex: 0.2,
        baseFeePercentageChange: 25,
        priorityFeePercentageChange: 0,
      };

      const payload = monitor.buildAlertPayload(
        enriched,
        40,
        2,
        Severity.WARNING,
        [],
      );

      expect(payload.recommendation).toMatch(/delay/i);
    });

    it('should deduplicate spikeTypes', () => {
      const enriched = {
        chainId: 1,
        baseFeeGwei: 50,
        priorityFeeGwei: 2,
        timestamp: 1700000000,
        movingAverageBaseFee: 40,
        movingAveragePriorityFee: 2,
        volatilityIndex: 0,
        baseFeePercentageChange: 25,
        priorityFeePercentageChange: 0,
      };
      const { SpikeType } = jest.requireActual('../enums/severity.enum');
      const payload = monitor.buildAlertPayload(
        enriched,
        40,
        2,
        Severity.WARNING,
        [SpikeType.BASE_FEE_PERCENTAGE, SpikeType.BASE_FEE_PERCENTAGE],
      );
      expect(payload.spikeTypes.length).toBe(1);
    });
  });
});
