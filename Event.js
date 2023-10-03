/**
 * @class
 */
export default class Event {
  /** @type {{ type: string, fn: Function}}*/
  hooks = {};

  /** @type {{ type: string, fn: Function}}*/
  originals = {};

  /**
   * Bind a new listen
   *
   * @param {string} type
   * @param {Function} callback
   */
  on(type, callback) {
    const key = type + ":" + callback.toString();

    const exists = this.originals[type]?.findIndex((_) => _.toString() === key);

    if (exists && exists !== -1) {
      this.hooks[type].splice(exists, 1);
      this.originals[type].splice(exists, 1);
    }

    if (!this.hooks[type]) {
      this.hooks[type] = [];
      this.originals[type] = [];
    }

    this.hooks[type].push(callback);
    this.originals[type].push(callback);

    return this;
  }

  /**
   * Trigger the linked hooks
   *
   * @param {string} type
   * @param {any} args
   */
  emit(type, ...args) {
    if (this.hooks[type]) {
      this.hooks[type].forEach((callback) => callback(...args));
    } else {
      // console.warn(`no listeners on ${type}`, args);
    }
  }

  removeListener(type, callback) {
    const key = type + ":" + callback.toString();
    const exists = this.originals[type]?.findIndex((_) => _.toString() === key);

    if (exists && exists !== -1) {
      this.hooks[type].splice(exists, 1);
      this.originals[type].splice(exists, 1);
    }
  }
}
