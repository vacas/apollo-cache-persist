import Log from './Log';
import Storage from './Storage';
import Cache from './Cache';

import { ApolloPersistOptions } from './types';

export interface PersistorConfig<T> {
  log: Log<T>;
  cache: Cache<T>;
  storage: Storage<T>;
}

export default class Persistor<T> {
  log: Log<T>;
  cache: Cache<T>;
  storage: Storage<T>;
  maxSize?: number;
  paused: boolean;
  whitelist?: Array<string>;
  blacklist?: Array<string>;

  constructor(
    { log, cache, storage }: PersistorConfig<T>,
    options: ApolloPersistOptions<T>
  ) {
    const { maxSize = 1024 * 1024, whitelist, blacklist } = options;

    this.log = log;
    this.cache = cache;
    this.storage = storage;
    this.paused = false;
    this.whitelist = whitelist;
    this.blacklist = blacklist;

    if (whitelist && blacklist) {
      this.log.error('Not necessary to set both whitelist and blacklist.');
    }

    if (maxSize) {
      this.maxSize = maxSize;
    }
  }

  filterMap(
    map: { [key: string]: any },
    filterFn: (key: string) => boolean
  ): { [key: string]: any } {
    return Object.keys(map)
      .filter(filterFn)
      .reduce((obj: { [key: string]: any }, key: string) => {
        obj[key] = map[key];
        return obj;
      }, {});
  }

  searchList(list: Array<string>, key: string, prefix: string = null): boolean {
    const keyArr = key.split(/[\.\(]/);
    for (let item of list) {
      if (
        (!prefix && keyArr[0] === item) ||
        (prefix && keyArr[0].includes(prefix) && keyArr[1] === item)
      ) {
        return true;
      }
    }
    return false;
  }

  async persist(): Promise<void> {
    try {
      const cacheData = this.cache.cache.extract() as { [key: string]: any };
      // first layer cache
      const filteredData = this.filterMap(cacheData, (key: string) => {
        if (key === 'ROOT_QUERY') return true;
        if (this.whitelist)
          return this.searchList(this.whitelist, key, 'ROOT_QUERY');
        if (this.blacklist)
          return !this.searchList(this.blacklist, key, 'ROOT_QUERY');
        return true;
      });
      // second layer cache under ROOT_QUERY
      filteredData['ROOT_QUERY'] = this.filterMap(
        filteredData['ROOT_QUERY'],
        (key: string) => {
          if (this.whitelist) return this.searchList(this.whitelist, key);
          if (this.blacklist) return !this.searchList(this.blacklist, key);
          return true;
        }
      );

      const data = JSON.stringify(filteredData);

      if (
        this.maxSize != null &&
        typeof data === 'string' &&
        data.length > this.maxSize &&
        !this.paused
      ) {
        await this.purge();
        this.paused = true;
        return;
      }

      if (this.paused) {
        this.paused = false;
      }

      await this.storage.write(data);
      this.log.info('Persisted cache', filteredData);

      this.log.info(
        typeof data === 'string'
          ? `Persisted cache of size ${data.length}`
          : 'Persisted cache'
      );
    } catch (error) {
      this.log.error('Error persisting cache', error);
      throw error;
    }
  }

  async restore(): Promise<void> {
    try {
      const data = await this.storage.read();

      if (data != null) {
        await this.cache.restore(data);

        this.log.info(
          typeof data === 'string'
            ? `Restored cache of size ${data.length}`
            : 'Restored cache'
        );
      } else {
        this.log.info('No stored cache to restore');
      }
    } catch (error) {
      this.log.error('Error restoring cache', error);
      throw error;
    }
  }

  async purge(): Promise<void> {
    try {
      await this.storage.purge();
      this.log.info('Purged cache storage');
    } catch (error) {
      this.log.error('Error purging cache storage', error);
      throw error;
    }
  }
}
