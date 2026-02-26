import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { WebhookDispatcherService } from '../services/webhook-dispatcher.service';
import { Severity } from '../enums/severity.enum';
import { AlertPayload } from '../interfaces/gas-spike.interface';
import { SpikeType } from '../enums/severity.enum';

const makePayload = (
  severity: Severity = Severity.CRITICAL,
  chainId = 1,
): AlertPayload => ({
  chainId,
  severity,
  spikeTypes: [SpikeType.BASE_FEE_PERCENTAGE],
  previousBaseFee: '32 gwei',
  currentBaseFee: '75 gwei',
  previousPriorityFee: '1 gwei',
  currentPriorityFee: '2 gwei',
  percentageIncrease: 134,
  volatilityIndex: 0.3,
  timestamp: 1700000000,
  recommendation: 'Pause automated transactions.',
});

describe('WebhookDispatcherService', () => {
  let service: WebhookDispatcherService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [WebhookDispatcherService],
    }).compile();

    service = module.get<WebhookDispatcherService>(WebhookDispatcherService);
  });

  // ─── register ───────────────────────────────────────────────────

  describe('register', () => {
    it('should create a subscription with generated id and secret', () => {
      const sub = service.register({ url: 'http://example.com/hook' });
      expect(sub.id).toBeDefined();
      expect(sub.secret).toBeDefined();
      expect(sub.url).toBe('http://example.com/hook');
      expect(sub.active).toBe(true);
    });

    it('should use provided secret', () => {
      const sub = service.register({
        url: 'http://example.com/hook',
        secret: 'a'.repeat(16),
      });
      expect(sub.secret).toBe('a'.repeat(16));
    });

    it('should use provided minSeverity', () => {
      const sub = service.register({
        url: 'http://example.com/hook',
        minSeverity: Severity.CRITICAL,
      });
      expect(sub.minSeverity).toBe(Severity.CRITICAL);
    });

    it('should default minSeverity to WARNING', () => {
      const sub = service.register({ url: 'http://example.com/hook' });
      expect(sub.minSeverity).toBe(Severity.WARNING);
    });

    it('should store chainIds', () => {
      const sub = service.register({
        url: 'http://example.com/hook',
        chainIds: [1, 137],
      });
      expect(sub.chainIds).toEqual([1, 137]);
    });
  });

  // ─── update ─────────────────────────────────────────────────────

  describe('update', () => {
    it('should update url and active flag', () => {
      const sub = service.register({ url: 'http://example.com/hook' });
      const updated = service.update(sub.id, {
        url: 'http://updated.com/hook',
        active: false,
      });
      expect(updated.url).toBe('http://updated.com/hook');
      expect(updated.active).toBe(false);
    });

    it('should throw NotFoundException for unknown id', () => {
      expect(() => service.update('nonexistent', {})).toThrow(NotFoundException);
    });

    it('should preserve unmodified fields', () => {
      const sub = service.register({
        url: 'http://example.com/hook',
        chainIds: [1],
      });
      const updated = service.update(sub.id, { active: false });
      expect(updated.chainIds).toEqual([1]);
    });
  });

  // ─── delete ─────────────────────────────────────────────────────

  describe('delete', () => {
    it('should remove a subscription', () => {
      const sub = service.register({ url: 'http://example.com/hook' });
      service.delete(sub.id);
      expect(service.list()).toHaveLength(0);
    });

    it('should throw NotFoundException for unknown id', () => {
      expect(() => service.delete('ghost')).toThrow(NotFoundException);
    });
  });

  // ─── list / findById ────────────────────────────────────────────

  describe('list', () => {
    it('should return all subscriptions', () => {
      service.register({ url: 'http://a.com' });
      service.register({ url: 'http://b.com' });
      expect(service.list()).toHaveLength(2);
    });
  });

  describe('findById', () => {
    it('should return subscription by id', () => {
      const sub = service.register({ url: 'http://example.com/hook' });
      expect(service.findById(sub.id).id).toBe(sub.id);
    });

    it('should throw NotFoundException for unknown id', () => {
      expect(() => service.findById('ghost')).toThrow(NotFoundException);
    });
  });

  // ─── HMAC signing ───────────────────────────────────────────────

  describe('sign / verify', () => {
    it('should produce consistent HMAC', () => {
      const sig1 = service.sign('{"test":1}', 'secret');
      const sig2 = service.sign('{"test":1}', 'secret');
      expect(sig1).toBe(sig2);
    });

    it('should produce different HMAC for different body', () => {
      const sig1 = service.sign('{"test":1}', 'secret');
      const sig2 = service.sign('{"test":2}', 'secret');
      expect(sig1).not.toBe(sig2);
    });

    it('should produce different HMAC for different secret', () => {
      const sig1 = service.sign('{"test":1}', 'secret1');
      const sig2 = service.sign('{"test":1}', 'secret2');
      expect(sig1).not.toBe(sig2);
    });

    it('should verify a valid signature', () => {
      const body = '{"test":1}';
      const secret = 'mysecret';
      const sig = service.sign(body, secret);
      expect(service.verify(body, secret, sig)).toBe(true);
    });

    it('should reject an invalid signature', () => {
      expect(service.verify('{"test":1}', 'secret', 'invalidsig')).toBe(false);
    });
  });

  // ─── dispatchAll ────────────────────────────────────────────────

  describe('dispatchAll', () => {
    let mockFetch: jest.SpyInstance;

    beforeEach(() => {
      mockFetch = jest.spyOn(global, 'fetch').mockResolvedValue({
        ok: true,
        status: 200,
      } as Response);
    });

    afterEach(() => {
      mockFetch.mockRestore();
    });

    it('should not call fetch when no subscriptions', async () => {
      await service.dispatchAll(makePayload());
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('should dispatch to matching subscription', async () => {
      service.register({ url: 'http://example.com/hook', minSeverity: Severity.WARNING });
      await service.dispatchAll(makePayload(Severity.CRITICAL));
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it('should not dispatch to inactive subscription', async () => {
      const sub = service.register({ url: 'http://example.com/hook' });
      service.update(sub.id, { active: false });
      await service.dispatchAll(makePayload());
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('should not dispatch when payload severity < minSeverity', async () => {
      service.register({
        url: 'http://example.com/hook',
        minSeverity: Severity.CRITICAL,
      });
      await service.dispatchAll(makePayload(Severity.INFO));
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('should not dispatch when chainId does not match subscription', async () => {
      service.register({
        url: 'http://example.com/hook',
        chainIds: [137],
      });
      await service.dispatchAll(makePayload(Severity.CRITICAL, 1));
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('should dispatch to all-chains subscription (empty chainIds)', async () => {
      service.register({ url: 'http://example.com/hook', chainIds: [] });
      await service.dispatchAll(makePayload(Severity.CRITICAL, 42));
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it('should include HMAC signature header', async () => {
      service.register({ url: 'http://example.com/hook' });
      await service.dispatchAll(makePayload());
      const [, options] = mockFetch.mock.calls[0];
      expect(options.headers['X-GasGuard-Signature']).toMatch(/^sha256=/);
    });

    it('should include subscription id header', async () => {
      const sub = service.register({ url: 'http://example.com/hook' });
      await service.dispatchAll(makePayload());
      const [, options] = mockFetch.mock.calls[0];
      expect(options.headers['X-GasGuard-Subscription-ID']).toBe(sub.id);
    });

    it('should dispatch to multiple matching subscriptions', async () => {
      service.register({ url: 'http://a.com/hook' });
      service.register({ url: 'http://b.com/hook' });
      await service.dispatchAll(makePayload());
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });
  });

  // ─── dispatchOne retry ──────────────────────────────────────────

  describe('dispatchOne retry', () => {
    it('should retry on 500 response', async () => {
      const sub = service.register({ url: 'http://example.com/hook' });
      const mockFetch = jest
        .spyOn(global, 'fetch')
        .mockResolvedValue({ ok: false, status: 500 } as Response);

      await service.dispatchOne(sub, makePayload());

      // Should have retried WEBHOOK_MAX_RETRIES times
      expect(mockFetch).toHaveBeenCalledTimes(3);
      mockFetch.mockRestore();
    });

    it('should succeed on second attempt', async () => {
      const sub = service.register({ url: 'http://example.com/hook' });
      let calls = 0;
      const mockFetch = jest.spyOn(global, 'fetch').mockImplementation(async () => {
        calls++;
        return calls === 1
          ? ({ ok: false, status: 500 } as Response)
          : ({ ok: true, status: 200 } as Response);
      });

      await service.dispatchOne(sub, makePayload());
      expect(mockFetch).toHaveBeenCalledTimes(2);
      mockFetch.mockRestore();
    });
  });
});
