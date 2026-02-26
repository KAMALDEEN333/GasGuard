import { Test, TestingModule } from '@nestjs/testing';
import { ThresholdEngineService } from '../services/threshold-engine.service';
import { SpikeClassifierService } from '../services/spike-classifier.service';
import { Severity, SpikeType } from '../enums/severity.enum';
import { EnrichedSnapshot } from '../interfaces/gas-spike.interface';
import { DEFAULT_THRESHOLDS } from '../constants/thresholds';

const makeEnriched = (
  overrides: Partial<EnrichedSnapshot> = {},
): EnrichedSnapshot => ({
  chainId: 1,
  baseFeeGwei: 20,
  priorityFeeGwei: 2,
  timestamp: 1700000000,
  movingAverageBaseFee: 20,
  movingAveragePriorityFee: 2,
  volatilityIndex: 0,
  baseFeePercentageChange: 0,
  priorityFeePercentageChange: 0,
  ...overrides,
});

describe('ThresholdEngineService', () => {
  let engine: ThresholdEngineService;
  let classifier: SpikeClassifierService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [ThresholdEngineService, SpikeClassifierService],
    }).compile();

    engine = module.get<ThresholdEngineService>(ThresholdEngineService);
    classifier = module.get<SpikeClassifierService>(SpikeClassifierService);
  });

  // ─── evaluate ───────────────────────────────────────────────────

  describe('evaluate', () => {
    it('should return empty array when nothing is triggered', () => {
      const results = engine.evaluate(makeEnriched());
      expect(results).toHaveLength(0);
    });

    it('should trigger BASE_FEE_PERCENTAGE INFO', () => {
      const results = engine.evaluate(
        makeEnriched({ baseFeePercentageChange: DEFAULT_THRESHOLDS.BASE_FEE_PERCENTAGE.INFO }),
      );
      const rule = results.find((r) => r.spikeType === SpikeType.BASE_FEE_PERCENTAGE);
      expect(rule).toBeDefined();
      expect(rule!.severity).toBe(Severity.INFO);
    });

    it('should trigger BASE_FEE_PERCENTAGE WARNING', () => {
      const results = engine.evaluate(
        makeEnriched({ baseFeePercentageChange: DEFAULT_THRESHOLDS.BASE_FEE_PERCENTAGE.WARNING }),
      );
      const rule = results.find((r) => r.spikeType === SpikeType.BASE_FEE_PERCENTAGE);
      expect(rule!.severity).toBe(Severity.WARNING);
    });

    it('should trigger BASE_FEE_PERCENTAGE CRITICAL', () => {
      const results = engine.evaluate(
        makeEnriched({ baseFeePercentageChange: DEFAULT_THRESHOLDS.BASE_FEE_PERCENTAGE.CRITICAL }),
      );
      const rule = results.find((r) => r.spikeType === SpikeType.BASE_FEE_PERCENTAGE);
      expect(rule!.severity).toBe(Severity.CRITICAL);
    });

    it('should trigger ABSOLUTE_THRESHOLD for high gwei', () => {
      const results = engine.evaluate(
        makeEnriched({ baseFeeGwei: DEFAULT_THRESHOLDS.ABSOLUTE_GWEI.CRITICAL }),
      );
      const rule = results.find((r) => r.spikeType === SpikeType.ABSOLUTE_THRESHOLD);
      expect(rule).toBeDefined();
      expect(rule!.severity).toBe(Severity.CRITICAL);
    });

    it('should trigger VOLATILITY_INDEX for high volatility', () => {
      const results = engine.evaluate(
        makeEnriched({ volatilityIndex: DEFAULT_THRESHOLDS.VOLATILITY_INDEX.CRITICAL }),
      );
      const rule = results.find((r) => r.spikeType === SpikeType.VOLATILITY_INDEX);
      expect(rule).toBeDefined();
      expect(rule!.severity).toBe(Severity.CRITICAL);
    });

    it('should trigger PRIORITY_FEE_SURGE when priority fee doubles', () => {
      const results = engine.evaluate(
        makeEnriched({ priorityFeePercentageChange: DEFAULT_THRESHOLDS.PRIORITY_FEE_PERCENTAGE.CRITICAL }),
      );
      const rule = results.find((r) => r.spikeType === SpikeType.PRIORITY_FEE_SURGE);
      expect(rule).toBeDefined();
      expect(rule!.severity).toBe(Severity.CRITICAL);
    });

    it('should trigger multiple rules simultaneously', () => {
      const results = engine.evaluate(
        makeEnriched({
          baseFeePercentageChange: DEFAULT_THRESHOLDS.BASE_FEE_PERCENTAGE.CRITICAL,
          baseFeeGwei: DEFAULT_THRESHOLDS.ABSOLUTE_GWEI.CRITICAL,
          volatilityIndex: DEFAULT_THRESHOLDS.VOLATILITY_INDEX.CRITICAL,
          priorityFeePercentageChange: DEFAULT_THRESHOLDS.PRIORITY_FEE_PERCENTAGE.CRITICAL,
        }),
      );
      expect(results).toHaveLength(4);
    });

    it('each result should include triggered=true', () => {
      const results = engine.evaluate(
        makeEnriched({ baseFeeGwei: 150 }),
      );
      results.forEach((r) => expect(r.triggered).toBe(true));
    });

    it('should record threshold value in result', () => {
      const results = engine.evaluate(
        makeEnriched({ baseFeePercentageChange: 45 }),
      );
      const rule = results.find((r) => r.spikeType === SpikeType.BASE_FEE_PERCENTAGE);
      expect(rule!.value).toBe(45);
      expect(rule!.threshold).toBe(DEFAULT_THRESHOLDS.BASE_FEE_PERCENTAGE.CRITICAL);
    });

    it('should respect custom thresholds from classifier', () => {
      classifier.setCustomThresholds({ baseFeePercentageCritical: 200 });
      // At 50% (default critical is 40), with custom=200 it should be Warning or Info
      const results = engine.evaluate(
        makeEnriched({ baseFeePercentageChange: 50 }),
      );
      const rule = results.find((r) => r.spikeType === SpikeType.BASE_FEE_PERCENTAGE);
      if (rule) expect(rule.severity).not.toBe(Severity.CRITICAL);
    });
  });

  // ─── highestSeverity ────────────────────────────────────────────

  describe('highestSeverity', () => {
    it('should return null for empty results', () => {
      expect(engine.highestSeverity([])).toBeNull();
    });

    it('should return CRITICAL when mixed severities', () => {
      const results = [
        { triggered: true, spikeType: SpikeType.BASE_FEE_PERCENTAGE, severity: Severity.INFO, value: 15, threshold: 15 },
        { triggered: true, spikeType: SpikeType.ABSOLUTE_THRESHOLD, severity: Severity.CRITICAL, value: 110, threshold: 100 },
        { triggered: true, spikeType: SpikeType.VOLATILITY_INDEX, severity: Severity.WARNING, value: 0.6, threshold: 0.6 },
      ];
      expect(engine.highestSeverity(results)).toBe(Severity.CRITICAL);
    });

    it('should return WARNING when only Info and Warning', () => {
      const results = [
        { triggered: true, spikeType: SpikeType.BASE_FEE_PERCENTAGE, severity: Severity.INFO, value: 15, threshold: 15 },
        { triggered: true, spikeType: SpikeType.ABSOLUTE_THRESHOLD, severity: Severity.WARNING, value: 80, threshold: 80 },
      ];
      expect(engine.highestSeverity(results)).toBe(Severity.WARNING);
    });

    it('should return INFO for single info result', () => {
      const results = [
        { triggered: true, spikeType: SpikeType.VOLATILITY_INDEX, severity: Severity.INFO, value: 0.4, threshold: 0.4 },
      ];
      expect(engine.highestSeverity(results)).toBe(Severity.INFO);
    });
  });
});
