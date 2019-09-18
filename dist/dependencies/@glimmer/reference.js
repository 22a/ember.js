import { LinkedList, ListNode, dict } from '@glimmer/util';
const symbol = typeof Symbol !== 'undefined' ? Symbol : key => `__${key}${Math.floor(Math.random() * Date.now())}__`;
const CONSTANT = 0;
const INITIAL = 1;
const VOLATILE = 9007199254740991; // MAX_INT

let $REVISION = INITIAL;

function bump() {
  $REVISION++;
} //////////


const COMPUTE = symbol('TAG_COMPUTE'); //////////

/**
 * `value` receives a tag and returns an opaque Revision based on that tag. This
 * snapshot can then later be passed to `validate` with the same tag to
 * determine if the tag has changed at all since the time that `value` was
 * called.
 *
 * The current implementation returns the global revision count directly for
 * performance reasons. This is an implementation detail, and should not be
 * relied on directly by users of these APIs. Instead, Revisions should be
 * treated as if they are opaque/unknown, and should only be interacted with via
 * the `value`/`validate` API.
 *
 * @param tag
 */

function value(_tag) {
  return $REVISION;
}
/**
 * `validate` receives a tag and a snapshot from a previous call to `value` with
 * the same tag, and determines if the tag is still valid compared to the
 * snapshot. If the tag's state has changed at all since then, `validate` will
 * return false, otherwise it will return true. This is used to determine if a
 * calculation related to the tags should be rerun.
 *
 * @param tag
 * @param snapshot
 */


function validate(tag, snapshot) {
  return snapshot >= tag[COMPUTE]();
}

const TYPE = symbol('TAG_TYPE');
let ALLOW_CYCLES;

class MonomorphicTagImpl {
  constructor(type) {
    this.revision = INITIAL;
    this.lastChecked = INITIAL;
    this.lastValue = INITIAL;
    this.isUpdating = false;
    this.subtag = null;
    this.subtags = null;
    this[TYPE] = type;
  }

  [COMPUTE]() {
    let {
      lastChecked
    } = this;

    if (lastChecked !== $REVISION) {
      this.isUpdating = true;
      this.lastChecked = $REVISION;

      try {
        let {
          subtags,
          subtag,
          revision
        } = this;

        if (subtag !== null) {
          revision = Math.max(revision, subtag[COMPUTE]());
        }

        if (subtags !== null) {
          for (let i = 0; i < subtags.length; i++) {
            let value = subtags[i][COMPUTE]();
            revision = Math.max(value, revision);
          }
        }

        this.lastValue = revision;
      } finally {
        this.isUpdating = false;
      }
    }

    if (this.isUpdating === true) {
      this.lastChecked = ++$REVISION;
    }

    return this.lastValue;
  }

  static update(_tag, subtag) {
    // TODO: TS 3.7 should allow us to do this via assertion
    let tag = _tag;

    if (subtag === CONSTANT_TAG) {
      tag.subtag = null;
    } else {
      tag.subtag = subtag; // subtag could be another type of tag, e.g. CURRENT_TAG or VOLATILE_TAG.
      // If so, lastChecked/lastValue will be undefined, result in these being
      // NaN. This is fine, it will force the system to recompute.

      tag.lastChecked = Math.min(tag.lastChecked, subtag.lastChecked);
      tag.lastValue = Math.max(tag.lastValue, subtag.lastValue);
    }
  }

  static dirty(tag) {
    tag.revision = ++$REVISION;
  }

}

const dirty = MonomorphicTagImpl.dirty;
const update = MonomorphicTagImpl.update; //////////

function createTag() {
  return new MonomorphicTagImpl(0
  /* Dirtyable */
  );
}

function createUpdatableTag() {
  return new MonomorphicTagImpl(1
  /* Updatable */
  );
} //////////


const CONSTANT_TAG = new MonomorphicTagImpl(3
/* Constant */
);

function isConst({
  tag
}) {
  return tag === CONSTANT_TAG;
}

function isConstTag(tag) {
  return tag === CONSTANT_TAG;
} //////////


class VolatileTag {
  [COMPUTE]() {
    return VOLATILE;
  }

}

const VOLATILE_TAG = new VolatileTag(); //////////

class CurrentTag {
  [COMPUTE]() {
    return $REVISION;
  }

}

const CURRENT_TAG = new CurrentTag(); //////////

function combineTagged(tagged) {
  let optimized = [];

  for (let i = 0, l = tagged.length; i < l; i++) {
    let tag = tagged[i].tag;
    if (tag === CONSTANT_TAG) continue;
    optimized.push(tag);
  }

  return _combine(optimized);
}

function combineSlice(slice) {
  let optimized = [];
  let node = slice.head();

  while (node !== null) {
    let tag = node.tag;
    if (tag !== CONSTANT_TAG) optimized.push(tag);
    node = slice.nextNode(node);
  }

  return _combine(optimized);
}

function combine(tags) {
  let optimized = [];

  for (let i = 0, l = tags.length; i < l; i++) {
    let tag = tags[i];
    if (tag === CONSTANT_TAG) continue;
    optimized.push(tag);
  }

  return _combine(optimized);
}

function _combine(tags) {
  switch (tags.length) {
    case 0:
      return CONSTANT_TAG;

    case 1:
      return tags[0];

    default:
      let tag = new MonomorphicTagImpl(2
      /* Combinator */
      );
      tag.subtags = tags;
      return tag;
  }
}

class CachedReference {
  constructor() {
    this.lastRevision = null;
    this.lastValue = null;
  }

  value() {
    let {
      tag,
      lastRevision,
      lastValue
    } = this;

    if (lastRevision === null || !validate(tag, lastRevision)) {
      lastValue = this.lastValue = this.compute();
      this.lastRevision = value(tag);
    }

    return lastValue;
  }

  invalidate() {
    this.lastRevision = null;
  }

}

class MapperReference extends CachedReference {
  constructor(reference, mapper) {
    super();
    this.tag = reference.tag;
    this.reference = reference;
    this.mapper = mapper;
  }

  compute() {
    let {
      reference,
      mapper
    } = this;
    return mapper(reference.value());
  }

}

function map(reference, mapper) {
  return new MapperReference(reference, mapper);
} //////////


class ReferenceCache {
  constructor(reference) {
    this.lastValue = null;
    this.lastRevision = null;
    this.initialized = false;
    this.tag = reference.tag;
    this.reference = reference;
  }

  peek() {
    if (!this.initialized) {
      return this.initialize();
    }

    return this.lastValue;
  }

  revalidate() {
    if (!this.initialized) {
      return this.initialize();
    }

    let {
      reference,
      lastRevision
    } = this;
    let tag = reference.tag;
    if (validate(tag, lastRevision)) return NOT_MODIFIED;
    this.lastRevision = value(tag);
    let {
      lastValue
    } = this;
    let currentValue = reference.value();
    if (currentValue === lastValue) return NOT_MODIFIED;
    this.lastValue = currentValue;
    return currentValue;
  }

  initialize() {
    let {
      reference
    } = this;
    let currentValue = this.lastValue = reference.value();
    this.lastRevision = value(reference.tag);
    this.initialized = true;
    return currentValue;
  }

}

const NOT_MODIFIED = 'adb3b78e-3d22-4e4b-877a-6317c2c5c145';

function isModified(value$$1) {
  return value$$1 !== NOT_MODIFIED;
}

class ConstReference {
  constructor(inner) {
    this.inner = inner;
    this.tag = CONSTANT_TAG;
  }

  value() {
    return this.inner;
  }

}

class ListItem extends ListNode {
  constructor(iterable, result) {
    super(iterable.valueReferenceFor(result));
    this.retained = false;
    this.seen = false;
    this.key = result.key;
    this.iterable = iterable;
    this.memo = iterable.memoReferenceFor(result);
  }

  update(item) {
    this.retained = true;
    this.iterable.updateValueReference(this.value, item);
    this.iterable.updateMemoReference(this.memo, item);
  }

  shouldRemove() {
    return !this.retained;
  }

  reset() {
    this.retained = false;
    this.seen = false;
  }

}

class IterationArtifacts {
  constructor(iterable) {
    this.iterator = null;
    this.map = dict();
    this.list = new LinkedList();
    this.tag = iterable.tag;
    this.iterable = iterable;
  }

  isEmpty() {
    let iterator = this.iterator = this.iterable.iterate();
    return iterator.isEmpty();
  }

  iterate() {
    let iterator;

    if (this.iterator === null) {
      iterator = this.iterable.iterate();
    } else {
      iterator = this.iterator;
    }

    this.iterator = null;
    return iterator;
  }

  has(key) {
    return !!this.map[key];
  }

  get(key) {
    return this.map[key];
  }

  wasSeen(key) {
    let node = this.map[key];
    return node !== undefined && node.seen;
  }

  append(item) {
    let {
      map,
      list,
      iterable
    } = this;
    let node = map[item.key] = new ListItem(iterable, item);
    list.append(node);
    return node;
  }

  insertBefore(item, reference) {
    let {
      map,
      list,
      iterable
    } = this;
    let node = map[item.key] = new ListItem(iterable, item);
    node.retained = true;
    list.insertBefore(node, reference);
    return node;
  }

  move(item, reference) {
    let {
      list
    } = this;
    item.retained = true;
    list.remove(item);
    list.insertBefore(item, reference);
  }

  remove(item) {
    let {
      list
    } = this;
    list.remove(item);
    delete this.map[item.key];
  }

  nextNode(item) {
    return this.list.nextNode(item);
  }

  head() {
    return this.list.head();
  }

}

class ReferenceIterator {
  // if anyone needs to construct this object with something other than
  // an iterable, let @wycats know.
  constructor(iterable) {
    this.iterator = null;
    let artifacts = new IterationArtifacts(iterable);
    this.artifacts = artifacts;
  }

  next() {
    let {
      artifacts
    } = this;
    let iterator = this.iterator = this.iterator || artifacts.iterate();
    let item = iterator.next();
    if (item === null) return null;
    return artifacts.append(item);
  }

}

var Phase;

(function (Phase) {
  Phase[Phase["Append"] = 0] = "Append";
  Phase[Phase["Prune"] = 1] = "Prune";
  Phase[Phase["Done"] = 2] = "Done";
})(Phase || (Phase = {}));

class IteratorSynchronizer {
  constructor({
    target,
    artifacts
  }) {
    this.target = target;
    this.artifacts = artifacts;
    this.iterator = artifacts.iterate();
    this.current = artifacts.head();
  }

  sync() {
    let phase = Phase.Append;

    while (true) {
      switch (phase) {
        case Phase.Append:
          phase = this.nextAppend();
          break;

        case Phase.Prune:
          phase = this.nextPrune();
          break;

        case Phase.Done:
          this.nextDone();
          return;
      }
    }
  }

  advanceToKey(key) {
    let {
      current,
      artifacts
    } = this;
    let seek = current;

    while (seek !== null && seek.key !== key) {
      seek.seen = true;
      seek = artifacts.nextNode(seek);
    }

    if (seek !== null) {
      this.current = artifacts.nextNode(seek);
    }
  }

  nextAppend() {
    let {
      iterator,
      current,
      artifacts
    } = this;
    let item = iterator.next();

    if (item === null) {
      return this.startPrune();
    }

    let {
      key
    } = item;

    if (current !== null && current.key === key) {
      this.nextRetain(item);
    } else if (artifacts.has(key)) {
      this.nextMove(item);
    } else {
      this.nextInsert(item);
    }

    return Phase.Append;
  }

  nextRetain(item) {
    let {
      artifacts,
      current
    } = this;
    current = current;
    current.update(item);
    this.current = artifacts.nextNode(current);
    this.target.retain(item.key, current.value, current.memo);
  }

  nextMove(item) {
    let {
      current,
      artifacts,
      target
    } = this;
    let {
      key
    } = item;
    let found = artifacts.get(item.key);
    found.update(item);

    if (artifacts.wasSeen(item.key)) {
      artifacts.move(found, current);
      target.move(found.key, found.value, found.memo, current ? current.key : null);
    } else {
      this.advanceToKey(key);
    }
  }

  nextInsert(item) {
    let {
      artifacts,
      target,
      current
    } = this;
    let node = artifacts.insertBefore(item, current);
    target.insert(node.key, node.value, node.memo, current ? current.key : null);
  }

  startPrune() {
    this.current = this.artifacts.head();
    return Phase.Prune;
  }

  nextPrune() {
    let {
      artifacts,
      target,
      current
    } = this;

    if (current === null) {
      return Phase.Done;
    }

    let node = current;
    this.current = artifacts.nextNode(node);

    if (node.shouldRemove()) {
      artifacts.remove(node);
      target.delete(node.key);
    } else {
      node.reset();
    }

    return Phase.Prune;
  }

  nextDone() {
    this.target.done();
  }

}

export { CachedReference, map, ReferenceCache, isModified, ConstReference, ListItem, IterationArtifacts, ReferenceIterator, IteratorSynchronizer, CONSTANT, INITIAL, VOLATILE, bump, COMPUTE, value, validate, ALLOW_CYCLES, MonomorphicTagImpl, dirty, update, createTag, createUpdatableTag, CONSTANT_TAG, isConst, isConstTag, VOLATILE_TAG, CURRENT_TAG, combineTagged, combineSlice, combine };