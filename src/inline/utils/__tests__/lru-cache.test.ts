import { LRUCache } from '../lru-cache';

describe('LRUCache', () => {
  describe('constructor', () => {
    it('throws for maxSize = 0', () => {
      expect(() => new LRUCache(0)).toThrow('LRUCache maxSize must be > 0');
    });

    it('throws for negative maxSize', () => {
      expect(() => new LRUCache(-1)).toThrow('LRUCache maxSize must be > 0');
    });

    it('throws for non-finite maxSize', () => {
      expect(() => new LRUCache(Infinity)).toThrow('LRUCache maxSize must be > 0');
      expect(() => new LRUCache(NaN)).toThrow('LRUCache maxSize must be > 0');
    });

    it('creates an empty cache with valid maxSize', () => {
      const c = new LRUCache<string, number>(3);
      expect(c.size).toBe(0);
    });
  });

  describe('set / get / has', () => {
    it('stores and retrieves a value', () => {
      const c = new LRUCache<string, number>(3);
      c.set('a', 1);
      expect(c.get('a')).toBe(1);
    });

    it('returns undefined for missing key', () => {
      const c = new LRUCache<string, number>(3);
      expect(c.get('missing')).toBeUndefined();
    });

    it('has() returns true for existing key', () => {
      const c = new LRUCache<string, number>(3);
      c.set('x', 42);
      expect(c.has('x')).toBe(true);
    });

    it('has() returns false for missing key', () => {
      const c = new LRUCache<string, number>(3);
      expect(c.has('x')).toBe(false);
    });

    it('overwrites an existing key', () => {
      const c = new LRUCache<string, number>(3);
      c.set('a', 1);
      c.set('a', 99);
      expect(c.get('a')).toBe(99);
      expect(c.size).toBe(1);
    });
  });

  describe('LRU eviction', () => {
    it('evicts the least-recently-used entry when full', () => {
      const c = new LRUCache<string, number>(2);
      c.set('a', 1);
      c.set('b', 2);
      c.set('c', 3); // 'a' should be evicted
      expect(c.has('a')).toBe(false);
      expect(c.get('b')).toBe(2);
      expect(c.get('c')).toBe(3);
    });

    it('get() promotes accessed entry so it is not evicted first', () => {
      const c = new LRUCache<string, number>(2);
      c.set('a', 1);
      c.set('b', 2);
      c.get('a'); // promote 'a' to MRU — 'b' is now LRU
      c.set('c', 3); // 'b' should be evicted
      expect(c.has('b')).toBe(false);
      expect(c.get('a')).toBe(1);
      expect(c.get('c')).toBe(3);
    });

    it('set() on existing key promotes it to MRU', () => {
      const c = new LRUCache<string, number>(2);
      c.set('a', 1);
      c.set('b', 2);
      c.set('a', 10); // promote 'a', 'b' becomes LRU
      c.set('c', 3);  // 'b' should be evicted
      expect(c.has('b')).toBe(false);
      expect(c.get('a')).toBe(10);
    });

    it('respects maxSize=1', () => {
      const c = new LRUCache<string, number>(1);
      c.set('a', 1);
      c.set('b', 2);
      expect(c.has('a')).toBe(false);
      expect(c.get('b')).toBe(2);
      expect(c.size).toBe(1);
    });
  });

  describe('delete', () => {
    it('removes an existing key and returns true', () => {
      const c = new LRUCache<string, number>(3);
      c.set('a', 1);
      expect(c.delete('a')).toBe(true);
      expect(c.has('a')).toBe(false);
    });

    it('returns false for a missing key', () => {
      const c = new LRUCache<string, number>(3);
      expect(c.delete('nope')).toBe(false);
    });
  });

  describe('clear', () => {
    it('removes all entries', () => {
      const c = new LRUCache<string, number>(3);
      c.set('a', 1);
      c.set('b', 2);
      c.clear();
      expect(c.size).toBe(0);
      expect(c.has('a')).toBe(false);
    });
  });

  describe('size', () => {
    it('tracks size correctly through set/delete', () => {
      const c = new LRUCache<string, number>(5);
      expect(c.size).toBe(0);
      c.set('a', 1);
      expect(c.size).toBe(1);
      c.set('b', 2);
      expect(c.size).toBe(2);
      c.delete('a');
      expect(c.size).toBe(1);
    });

    it('does not exceed maxSize', () => {
      const c = new LRUCache<number, number>(3);
      for (let i = 0; i < 10; i++) c.set(i, i);
      expect(c.size).toBe(3);
    });
  });
});
