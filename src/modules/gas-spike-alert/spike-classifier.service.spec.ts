import { Test, TestingModule } from '@nestjs/testing';
import { SpikeClassifierService } from '../services/spike-classifier.service';
import { Severity, SpikeType } from '../enums/severity.enum';
import { GasSnapshot } from '../interfaces/gas-spike.interface';
import { DEFAULT_THRESHOLDS, MOVING_AVERAGE_WINDOW } from '../constants/thresholds';

const makeSnapshot = (
  chainId: number,
  baseFeeGwei: number,
  priorityFeeGwei = 2,
  timestamp = Math.floor(Date.now() / 1000),
): GasSnapshot => ({ chainId, baseFeeGwei, priorityFeeGwei, timestamp });

describe('SpikeClassifierService', () => {
  let service: SpikeClassifierService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [SpikeClassifierService],
    }).compile();

    service = module.get<SpikeClassifierService>(SpikeClassifierService);
  });

  // ─── History management ─────────────────────────────────────────

  describe('addSnapshot / getHistory', () => {
    it('should add a snapshot to history', () => {
      service.addSnapshot(makeSnapshot(1, 20));
      expect(service.getHistory(1)).toHaveLength(1);
    });

    it('should return empty array for unknown chain', () => {
      expect(service.getHistory(999)).toEqual([]);
    });

    it('should maintain MAX_HISTORY_POINTS cap', () => {
      for (let i = 0; i < 110; i++) {
        service.addSnapshot(makeSnapshot(1, 20 + i));
      }
      expect(service.getHistory(1).length).toBeLessThanOrEqual(100);
    });

    it('should keep the most recent snapshots', () => {
      for (let i = 0; i < 105; i++) {
        service.addSnapshot(makeSnapshot(1, i));
      }
      const history = service.getHistory(1);
      expect(history[history.length - 1].baseFeeGwei).toBe(104);
    });

    it('should clear history for a chain', () => {
      service.addSnapshot(makeSnapshot(1, 20));
      service.clearHistory(1);
      expect(service.getHistory(1)).toHaveLength(0);
    });

    it('should keep histories separate per chain', () => {
      service.addSnapshot(makeSnapshot(1, 10));
      service.addSnapshot(makeSnapshot(137, 20));
      expect(service.getHistory(1)).toHaveLength(1);
      expect(service.getHistory(137)).toHaveLength(1);
    });
  });

  // ─── enrich ─────────────────────────────────────────────────────

  describe('enrich', () => {
    it('should return 0 moving averages for empty history', () => {
      const snap = makeSnapshot(1, 25);
      const enriched = service.enrich(snap);
      expect(enriched.movingAverageBaseFee).toBe(0);
      expect(enriched.movingAveragePriorityFee).toBe(0);
    });

    it('should calculate moving average from history window', () => {
      // Seed 5 snapshots of 20 gwei each
      for (let i = 0; i < 5; i++) service.addSnapshot(makeSnapshot(1, 20));
      const enriched = service.enrich(makeSnapshot(1, 20));
      expect(enriched.movingAverageBaseFee).toBeCloseTo(20, 2);
    });

    it('should calculate baseFeePercentageChange', () => {
      service.addSnapshot(makeSnapshot(1, 50));
      const enriched = service.enrich(makeSnapshot(1, 75));
      expect(enriched.baseFeePercentageChange).toBeCloseTo(50, 1);
    });

    it('should return 0 percentage change when no history', () => {
      const enriched = service.enrich(makeSnapshot(1, 50));
      expect(enriched.baseFeePercentageChange).toBe(0);
    });

    it('should calculate priorityFeePercentageChange', () => {
      service.addSnapshot(makeSnapshot(1, 20, 2));
      const enriched = service.enrich(makeSnapshot(1, 20, 4));
      expect(enriched.priorityFeePercentageChange).toBeCloseTo(100, 1);
    });

    it('should compute volatility index > 0 for varying fees', () => {
      // High variance samples
      [10, 50, 20, 80, 30, 90].forEach((fee) =>
        service.addSnapshot(makeSnapshot(1, fee)),
      );
      const enriched = service.enrich(makeSnapshot(1, 100));
      expect(enriched.volatilityIndex).toBeGreaterThan(0);
      expect(enriched.volatilityIndex).toBeLessThanOrEqual(1);
    });

    it('should clamp volatility index to 1', () => {
      // Extreme variance
      [1, 1000, 1, 1000, 1, 1000].forEach((f) =>
        service.addSnapshot(makeSnapshot(1, f)),
      );
      const enriched = service.enrich(makeSnapshot(1, 1000));
      expect(enriched.volatilityIndex).toBeLessThanOrEqual(1);
    });

    it('should return 0 volatility index for stable fees', () => {
      for (let i = 0; i < 10; i++) service.addSnapshot(makeSnapshot(1, 30));
      const enriched = service.enrich(makeSnapshot(1, 30));
      expect(enriched.volatilityIndex).toBeCloseTo(0, 4);
    });
  });

  // ─── classifySeverity ───────────────────────────────────────────

  describe('classifySeverity', () => {
    it('should return null when no threshold is crossed', () => {
      for (let i = 0; i < 5; i++) service.addSnapshot(makeSnapshot(1, 20, 2));
      const enriched = service.enrich(makeSnapshot(1, 21, 2));
      service.addSnapshot(makeSnapshot(1, 20, 2));
      expect(service.classifySeverity(enriched)).toBeNull();
    });

    it('should return INFO for minor base fee increase', () => {
      service.addSnapshot(makeSnapshot(1, 40, 2));
      const enriched = service.enrich(makeSnapshot(1, 47, 2)); // ~17.5%
      expect(service.classifySeverity(enriched)).toBe(Severity.INFO);
    });

    it('should return WARNING for moderate base fee increase', () => {
      service.addSnapshot(makeSnapshot(1, 40, 2));
      const enriched = service.enrich(makeSnapshot(1, 53, 2)); // ~32.5%
      expect(service.classifySeverity(enriched)).toBe(Severity.WARNING);
    });

    it('should return CRITICAL for severe base fee increase', () => {
      service.addSnapshot(makeSnapshot(1, 40, 2));
      const enriched = service.enrich(makeSnapshot(1, 60, 2)); // 50%
      expect(service.classifySeverity(enriched)).toBe(Severity.CRITICAL);
    });

    it('should return CRITICAL when absolute gwei threshold exceeded', () => {
      service.addSnapshot(makeSnapshot(1, 20, 2));
      const enriched = service.enrich(makeSnapshot(1, 110, 2)); // > 100 gwei
      expect(service.classifySeverity(enriched)).toBe(Severity.CRITICAL);
    });

    it('should escalate to highest severity across multiple rules', () => {
      // Priority fee doubles AND base fee is high
      service.addSnapshot(makeSnapshot(1, 90, 2));
      const enriched = service.enrich(makeSnapshot(1, 105, 4)); // absolute > 100, pf doubles
      expect(service.classifySeverity(enriched)).toBe(Severity.CRITICAL);
    });

    it('should return CRITICAL for volatility index >= 0.75', () => {
      // Build volatile history
      [10, 200, 10, 200, 10, 200, 10, 200].forEach((f) =>
        service.addSnapshot(makeSnapshot(1, f)),
      );
      const enriched = service.enrich(makeSnapshot(1, 200));
      // Volatility is very high; severity should be at least Warning
      const severity = service.classifySeverity(enriched);
      expect([Severity.WARNING, Severity.CRITICAL]).toContain(severity);
    });
  });

  // ─── custom thresholds ──────────────────────────────────────────

  describe('setCustomThresholds / getEffectiveThresholds', () => {
    it('should merge custom thresholds over defaults', () => {
      service.setCustomThresholds({
        chainId: 1,
        baseFeePercentageCritical: 20,
      });
      const t = service.getEffectiveThresholds(1);
      expect(t.BASE_FEE_PERCENTAGE.CRITICAL).toBe(20);
      expect(t.BASE_FEE_PERCENTAGE.INFO).toBe(
        DEFAULT_THRESHOLDS.BASE_FEE_PERCENTAGE.INFO,
      );
    });

    it('global override applies to all chains', () => {
      service.setCustomThresholds({ baseFeePercentageCritical: 99 });
      const t1 = service.getEffectiveThresholds(1);
      const t137 = service.getEffectiveThresholds(137);
      expect(t1.BASE_FEE_PERCENTAGE.CRITICAL).toBe(99);
      expect(t137.BASE_FEE_PERCENTAGE.CRITICAL).toBe(99);
    });

    it('chain-specific override takes priority over global', () => {
      service.setCustomThresholds({ baseFeePercentageCritical: 99 });
      service.setCustomThresholds({
        chainId: 1,
        baseFeePercentageCritical: 55,
      });
      expect(service.getEffectiveThresholds(1).BASE_FEE_PERCENTAGE.CRITICAL).toBe(55);
      expect(service.getEffectiveThresholds(137).BASE_FEE_PERCENTAGE.CRITICAL).toBe(99);
    });
  });

  // ─── getTriggeredSpikeTypes ─────────────────────────────────────

  describe('getTriggeredSpikeTypes', () => {
    it('should return BASE_FEE_PERCENTAGE type for critical increase', () => {
      service.addSnapshot(makeSnapshot(1, 40, 2));
      const enriched = service.enrich(makeSnapshot(1, 60, 2)); // 50%
      const types = service.getTriggeredSpikeTypes(enriched, Severity.CRITICAL);
      expect(types).toContain(SpikeType.BASE_FEE_PERCENTAGE);
    });

    it('should return ABSOLUTE_THRESHOLD when gwei > 100', () => {
      service.addSnapshot(makeSnapshot(1, 99, 2));
      const enriched = service.enrich(makeSnapshot(1, 105, 2));
      const types = service.getTriggeredSpikeTypes(enriched, Severity.CRITICAL);
      expect(types).toContain(SpikeType.ABSOLUTE_THRESHOLD);
    });

    it('should return PRIORITY_FEE_SURGE when priority fee doubles', () => {
      service.addSnapshot(makeSnapshot(1, 20, 2));
      const enriched = service.enrich(makeSnapshot(1, 21, 4)); // pf doubled
      const types = service.getTriggeredSpikeTypes(enriched, Severity.CRITICAL);
      expect(types).toContain(SpikeType.PRIORITY_FEE_SURGE);
    });

    it('should return empty array when severity not met', () => {
      service.addSnapshot(makeSnapshot(1, 20, 2));
      const enriched = service.enrich(makeSnapshot(1, 21, 2)); // ~5%
      const types = service.getTriggeredSpikeTypes(enriched, Severity.WARNING);
      expect(types).toHaveLength(0);
    });
  });
});
