/**
 * Abyssal's own lint rule, loaded by oxlint as a JS plugin from oxlint.config.ts.
 *
 * `abyssal/keys-from-table`: every key name and key check comes from client/src/keys.ts, so a key
 * change is one edit there. It reports a key name written bold by hand in a string, such as
 * "<b>Space</b>", and a keyboard event's `code` or `key` compared with or switched on a string.
 */

/** Bold text short enough to be a key name; a `$` marks a replacement pattern, as in keys.ts's own `bold`. */
const HAND_KEY = /<b>[^<\s$]{1,6}<\/b>/u;

const isKeyField = (node) =>
  node?.type === "MemberExpression" &&
  !node.computed &&
  (node.property.name === "code" || node.property.name === "key");

const isString = (node) =>
  node?.type === "Literal" && typeof node.value === "string";

const EQUALITY = new Set(["===", "!==", "==", "!="]);

const keysFromTable = {
  create(context) {
    const handName = (node, text) => {
      if (HAND_KEY.test(text)) {
        context.report({
          node,
          message:
            "Name a key with bold(KEYS.<action>.name) from client/src/keys.ts, not by hand.",
        });
      }
    };
    const handCheck = (node) =>
      context.report({
        node,
        message:
          "Check a key with presses(e, KEYS.<action>) from client/src/keys.ts, not against a string.",
      });
    return {
      BinaryExpression(node) {
        if (
          EQUALITY.has(node.operator) &&
          ((isKeyField(node.left) && isString(node.right)) ||
            (isKeyField(node.right) && isString(node.left)))
        ) {
          handCheck(node);
        }
      },
      Literal(node) {
        if (typeof node.value === "string") {
          handName(node, node.value);
        }
      },
      SwitchStatement(node) {
        if (isKeyField(node.discriminant)) {
          handCheck(node);
        }
      },
      TemplateElement(node) {
        handName(node, node.value.cooked ?? node.value.raw);
      },
    };
  },
};

export default {
  meta: { name: "abyssal" },
  rules: { "keys-from-table": keysFromTable },
};
