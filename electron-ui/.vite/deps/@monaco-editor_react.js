import { r as __toESM } from "./chunk-BoAXSpZd.js";
import { t as require_react } from "./react.js";
//#region node_modules/@monaco-editor/loader/lib/es/_virtual/_rollupPluginBabelHelpers.js
function _arrayLikeToArray(r, a) {
	(null == a || a > r.length) && (a = r.length);
	for (var e = 0, n = Array(a); e < a; e++) n[e] = r[e];
	return n;
}
function _arrayWithHoles(r) {
	if (Array.isArray(r)) return r;
}
function _defineProperty$1(e, r, t) {
	return (r = _toPropertyKey(r)) in e ? Object.defineProperty(e, r, {
		value: t,
		enumerable: true,
		configurable: true,
		writable: true
	}) : e[r] = t, e;
}
function _iterableToArrayLimit(r, l) {
	var t = null == r ? null : "undefined" != typeof Symbol && r[Symbol.iterator] || r["@@iterator"];
	if (null != t) {
		var e, n, i, u, a = [], f = true, o = false;
		try {
			if (i = (t = t.call(r)).next, 0 === l);
			else for (; !(f = (e = i.call(t)).done) && (a.push(e.value), a.length !== l); f = !0);
		} catch (r) {
			o = true, n = r;
		} finally {
			try {
				if (!f && null != t.return && (u = t.return(), Object(u) !== u)) return;
			} finally {
				if (o) throw n;
			}
		}
		return a;
	}
}
function _nonIterableRest() {
	throw new TypeError("Invalid attempt to destructure non-iterable instance.\nIn order to be iterable, non-array objects must have a [Symbol.iterator]() method.");
}
function ownKeys$1(e, r) {
	var t = Object.keys(e);
	if (Object.getOwnPropertySymbols) {
		var o = Object.getOwnPropertySymbols(e);
		r && (o = o.filter(function(r) {
			return Object.getOwnPropertyDescriptor(e, r).enumerable;
		})), t.push.apply(t, o);
	}
	return t;
}
function _objectSpread2$1(e) {
	for (var r = 1; r < arguments.length; r++) {
		var t = null != arguments[r] ? arguments[r] : {};
		r % 2 ? ownKeys$1(Object(t), true).forEach(function(r) {
			_defineProperty$1(e, r, t[r]);
		}) : Object.getOwnPropertyDescriptors ? Object.defineProperties(e, Object.getOwnPropertyDescriptors(t)) : ownKeys$1(Object(t)).forEach(function(r) {
			Object.defineProperty(e, r, Object.getOwnPropertyDescriptor(t, r));
		});
	}
	return e;
}
function _objectWithoutProperties(e, t) {
	if (null == e) return {};
	var o, r, i = _objectWithoutPropertiesLoose(e, t);
	if (Object.getOwnPropertySymbols) {
		var n = Object.getOwnPropertySymbols(e);
		for (r = 0; r < n.length; r++) o = n[r], -1 === t.indexOf(o) && {}.propertyIsEnumerable.call(e, o) && (i[o] = e[o]);
	}
	return i;
}
function _objectWithoutPropertiesLoose(r, e) {
	if (null == r) return {};
	var t = {};
	for (var n in r) if ({}.hasOwnProperty.call(r, n)) {
		if (-1 !== e.indexOf(n)) continue;
		t[n] = r[n];
	}
	return t;
}
function _slicedToArray(r, e) {
	return _arrayWithHoles(r) || _iterableToArrayLimit(r, e) || _unsupportedIterableToArray(r, e) || _nonIterableRest();
}
function _toPrimitive(t, r) {
	if ("object" != typeof t || !t) return t;
	var e = t[Symbol.toPrimitive];
	if (void 0 !== e) {
		var i = e.call(t, r);
		if ("object" != typeof i) return i;
		throw new TypeError("@@toPrimitive must return a primitive value.");
	}
	return ("string" === r ? String : Number)(t);
}
function _toPropertyKey(t) {
	var i = _toPrimitive(t, "string");
	return "symbol" == typeof i ? i : i + "";
}
function _unsupportedIterableToArray(r, a) {
	if (r) {
		if ("string" == typeof r) return _arrayLikeToArray(r, a);
		var t = {}.toString.call(r).slice(8, -1);
		return "Object" === t && r.constructor && (t = r.constructor.name), "Map" === t || "Set" === t ? Array.from(r) : "Arguments" === t || /^(?:Ui|I)nt(?:8|16|32)(?:Clamped)?Array$/.test(t) ? _arrayLikeToArray(r, a) : void 0;
	}
}
//#endregion
//#region node_modules/state-local/lib/es/state-local.js
function _defineProperty(obj, key, value) {
	if (key in obj) Object.defineProperty(obj, key, {
		value,
		enumerable: true,
		configurable: true,
		writable: true
	});
	else obj[key] = value;
	return obj;
}
function ownKeys(object, enumerableOnly) {
	var keys = Object.keys(object);
	if (Object.getOwnPropertySymbols) {
		var symbols = Object.getOwnPropertySymbols(object);
		if (enumerableOnly) symbols = symbols.filter(function(sym) {
			return Object.getOwnPropertyDescriptor(object, sym).enumerable;
		});
		keys.push.apply(keys, symbols);
	}
	return keys;
}
function _objectSpread2(target) {
	for (var i = 1; i < arguments.length; i++) {
		var source = arguments[i] != null ? arguments[i] : {};
		if (i % 2) ownKeys(Object(source), true).forEach(function(key) {
			_defineProperty(target, key, source[key]);
		});
		else if (Object.getOwnPropertyDescriptors) Object.defineProperties(target, Object.getOwnPropertyDescriptors(source));
		else ownKeys(Object(source)).forEach(function(key) {
			Object.defineProperty(target, key, Object.getOwnPropertyDescriptor(source, key));
		});
	}
	return target;
}
function compose$1() {
	for (var _len = arguments.length, fns = new Array(_len), _key = 0; _key < _len; _key++) fns[_key] = arguments[_key];
	return function(x) {
		return fns.reduceRight(function(y, f) {
			return f(y);
		}, x);
	};
}
function curry$1(fn) {
	return function curried() {
		var _this = this;
		for (var _len2 = arguments.length, args = new Array(_len2), _key2 = 0; _key2 < _len2; _key2++) args[_key2] = arguments[_key2];
		return args.length >= fn.length ? fn.apply(this, args) : function() {
			for (var _len3 = arguments.length, nextArgs = new Array(_len3), _key3 = 0; _key3 < _len3; _key3++) nextArgs[_key3] = arguments[_key3];
			return curried.apply(_this, [].concat(args, nextArgs));
		};
	};
}
function isObject$1(value) {
	return {}.toString.call(value).includes("Object");
}
function isEmpty(obj) {
	return !Object.keys(obj).length;
}
function isFunction(value) {
	return typeof value === "function";
}
function hasOwnProperty(object, property) {
	return Object.prototype.hasOwnProperty.call(object, property);
}
function validateChanges(initial, changes) {
	if (!isObject$1(changes)) errorHandler$1("changeType");
	if (Object.keys(changes).some(function(field) {
		return !hasOwnProperty(initial, field);
	})) errorHandler$1("changeField");
	return changes;
}
function validateSelector(selector) {
	if (!isFunction(selector)) errorHandler$1("selectorType");
}
function validateHandler(handler) {
	if (!(isFunction(handler) || isObject$1(handler))) errorHandler$1("handlerType");
	if (isObject$1(handler) && Object.values(handler).some(function(_handler) {
		return !isFunction(_handler);
	})) errorHandler$1("handlersType");
}
function validateInitial(initial) {
	if (!initial) errorHandler$1("initialIsRequired");
	if (!isObject$1(initial)) errorHandler$1("initialType");
	if (isEmpty(initial)) errorHandler$1("initialContent");
}
function throwError$1(errorMessages, type) {
	throw new Error(errorMessages[type] || errorMessages["default"]);
}
var errorHandler$1 = curry$1(throwError$1)({
	initialIsRequired: "initial state is required",
	initialType: "initial state should be an object",
	initialContent: "initial state shouldn't be an empty object",
	handlerType: "handler should be an object or a function",
	handlersType: "all handlers should be a functions",
	selectorType: "selector should be a function",
	changeType: "provided value of changes should be an object",
	changeField: "it seams you want to change a field in the state which is not specified in the \"initial\" state",
	"default": "an unknown error accured in `state-local` package"
});
var validators$1 = {
	changes: validateChanges,
	selector: validateSelector,
	handler: validateHandler,
	initial: validateInitial
};
function create(initial) {
	var handler = arguments.length > 1 && arguments[1] !== void 0 ? arguments[1] : {};
	validators$1.initial(initial);
	validators$1.handler(handler);
	var state = { current: initial };
	var didUpdate = curry$1(didStateUpdate)(state, handler);
	var update = curry$1(updateState)(state);
	var validate = curry$1(validators$1.changes)(initial);
	var getChanges = curry$1(extractChanges)(state);
	function getState() {
		var selector = arguments.length > 0 && arguments[0] !== void 0 ? arguments[0] : function(state) {
			return state;
		};
		validators$1.selector(selector);
		return selector(state.current);
	}
	function setState(causedChanges) {
		compose$1(didUpdate, update, validate, getChanges)(causedChanges);
	}
	return [getState, setState];
}
function extractChanges(state, causedChanges) {
	return isFunction(causedChanges) ? causedChanges(state.current) : causedChanges;
}
function updateState(state, changes) {
	state.current = _objectSpread2(_objectSpread2({}, state.current), changes);
	return changes;
}
function didStateUpdate(state, handler, changes) {
	isFunction(handler) ? handler(state.current) : Object.keys(changes).forEach(function(field) {
		var _handler$field;
		return (_handler$field = handler[field]) === null || _handler$field === void 0 ? void 0 : _handler$field.call(handler, state.current[field]);
	});
	return changes;
}
var index = { create };
//#endregion
//#region node_modules/@monaco-editor/loader/lib/es/config/index.js
var config$1 = { paths: { vs: "https://cdn.jsdelivr.net/npm/monaco-editor@0.55.1/min/vs" } };
//#endregion
//#region node_modules/@monaco-editor/loader/lib/es/utils/curry.js
function curry(fn) {
	return function curried() {
		var _this = this;
		for (var _len = arguments.length, args = new Array(_len), _key = 0; _key < _len; _key++) args[_key] = arguments[_key];
		return args.length >= fn.length ? fn.apply(this, args) : function() {
			for (var _len2 = arguments.length, nextArgs = new Array(_len2), _key2 = 0; _key2 < _len2; _key2++) nextArgs[_key2] = arguments[_key2];
			return curried.apply(_this, [].concat(args, nextArgs));
		};
	};
}
//#endregion
//#region node_modules/@monaco-editor/loader/lib/es/utils/isObject.js
function isObject(value) {
	return {}.toString.call(value).includes("Object");
}
//#endregion
//#region node_modules/@monaco-editor/loader/lib/es/validators/index.js
/**
* validates the configuration object and informs about deprecation
* @param {Object} config - the configuration object 
* @return {Object} config - the validated configuration object
*/
function validateConfig(config) {
	if (!config) errorHandler("configIsRequired");
	if (!isObject(config)) errorHandler("configType");
	if (config.urls) {
		informAboutDeprecation();
		return { paths: { vs: config.urls.monacoBase } };
	}
	return config;
}
/**
* logs deprecation message
*/
function informAboutDeprecation() {
	console.warn(errorMessages.deprecation);
}
function throwError(errorMessages, type) {
	throw new Error(errorMessages[type] || errorMessages["default"]);
}
var errorMessages = {
	configIsRequired: "the configuration object is required",
	configType: "the configuration object should be an object",
	"default": "an unknown error accured in `@monaco-editor/loader` package",
	deprecation: "Deprecation warning!\n    You are using deprecated way of configuration.\n\n    Instead of using\n      monaco.config({ urls: { monacoBase: '...' } })\n    use\n      monaco.config({ paths: { vs: '...' } })\n\n    For more please check the link https://github.com/suren-atoyan/monaco-loader#config\n  "
};
var errorHandler = curry(throwError)(errorMessages);
var validators = { config: validateConfig };
//#endregion
//#region node_modules/@monaco-editor/loader/lib/es/utils/compose.js
var compose = function compose() {
	for (var _len = arguments.length, fns = new Array(_len), _key = 0; _key < _len; _key++) fns[_key] = arguments[_key];
	return function(x) {
		return fns.reduceRight(function(y, f) {
			return f(y);
		}, x);
	};
};
//#endregion
//#region node_modules/@monaco-editor/loader/lib/es/utils/deepMerge.js
function merge(target, source) {
	Object.keys(source).forEach(function(key) {
		if (source[key] instanceof Object) {
			if (target[key]) Object.assign(source[key], merge(target[key], source[key]));
		}
	});
	return _objectSpread2$1(_objectSpread2$1({}, target), source);
}
//#endregion
//#region node_modules/@monaco-editor/loader/lib/es/utils/makeCancelable.js
var CANCELATION_MESSAGE = {
	type: "cancelation",
	msg: "operation is manually canceled"
};
function makeCancelable(promise) {
	var hasCanceled_ = false;
	var wrappedPromise = new Promise(function(resolve, reject) {
		promise.then(function(val) {
			return hasCanceled_ ? reject(CANCELATION_MESSAGE) : resolve(val);
		});
		promise["catch"](reject);
	});
	return wrappedPromise.cancel = function() {
		return hasCanceled_ = true;
	}, wrappedPromise;
}
//#endregion
//#region node_modules/@monaco-editor/loader/lib/es/loader/index.js
var _excluded = ["monaco"];
/** the local state of the module */
var _state$create2 = _slicedToArray(index.create({
	config: config$1,
	isInitialized: false,
	resolve: null,
	reject: null,
	monaco: null
}), 2), getState = _state$create2[0], setState = _state$create2[1];
/**
* set the loader configuration
* @param {Object} config - the configuration object
*/
function config(globalConfig) {
	var _validators$config = validators.config(globalConfig), monaco = _validators$config.monaco, config = _objectWithoutProperties(_validators$config, _excluded);
	setState(function(state) {
		return {
			config: merge(state.config, config),
			monaco
		};
	});
}
/**
* handles the initialization of the monaco-editor
* @return {Promise} - returns an instance of monaco (with a cancelable promise)
*/
function init() {
	var state = getState(function(_ref) {
		return {
			monaco: _ref.monaco,
			isInitialized: _ref.isInitialized,
			resolve: _ref.resolve
		};
	});
	if (!state.isInitialized) {
		setState({ isInitialized: true });
		if (state.monaco) {
			state.resolve(state.monaco);
			return makeCancelable(wrapperPromise);
		}
		if (window.monaco && window.monaco.editor) {
			storeMonacoInstance(window.monaco);
			state.resolve(window.monaco);
			return makeCancelable(wrapperPromise);
		}
		compose(injectScripts, getMonacoLoaderScript)(configureLoader);
	}
	return makeCancelable(wrapperPromise);
}
/**
* injects provided scripts into the document.body
* @param {Object} script - an HTML script element
* @return {Object} - the injected HTML script element
*/
function injectScripts(script) {
	return document.body.appendChild(script);
}
/**
* creates an HTML script element with/without provided src
* @param {string} [src] - the source path of the script
* @return {Object} - the created HTML script element
*/
function createScript(src) {
	var script = document.createElement("script");
	return src && (script.src = src), script;
}
/**
* creates an HTML script element with the monaco loader src
* @return {Object} - the created HTML script element
*/
function getMonacoLoaderScript(configureLoader) {
	var state = getState(function(_ref2) {
		return {
			config: _ref2.config,
			reject: _ref2.reject
		};
	});
	var loaderScript = createScript("".concat(state.config.paths.vs, "/loader.js"));
	loaderScript.onload = function() {
		return configureLoader();
	};
	loaderScript.onerror = state.reject;
	return loaderScript;
}
/**
* configures the monaco loader
*/
function configureLoader() {
	var state = getState(function(_ref3) {
		return {
			config: _ref3.config,
			resolve: _ref3.resolve,
			reject: _ref3.reject
		};
	});
	var require = window.require;
	require.config(state.config);
	require(["vs/editor/editor.main"], function(loaded) {
		var monaco = loaded.m || loaded;
		storeMonacoInstance(monaco);
		state.resolve(monaco);
	}, function(error) {
		state.reject(error);
	});
}
/**
* store monaco instance in local state
*/
function storeMonacoInstance(monaco) {
	if (!getState().monaco) setState({ monaco });
}
/**
* internal helper function
* extracts stored monaco instance
* @return {Object|null} - the monaco instance
*/
function __getMonacoInstance() {
	return getState(function(_ref4) {
		return _ref4.monaco;
	});
}
var wrapperPromise = new Promise(function(resolve, reject) {
	return setState({
		resolve,
		reject
	});
});
var loader = {
	config,
	init,
	__getMonacoInstance
};
//#endregion
//#region node_modules/@monaco-editor/react/dist/index.mjs
var import_react = /* @__PURE__ */ __toESM(require_react(), 1);
var v = {
	wrapper: {
		display: "flex",
		position: "relative",
		textAlign: "initial"
	},
	fullWidth: { width: "100%" },
	hide: { display: "none" }
};
var Y = { container: {
	display: "flex",
	height: "100%",
	width: "100%",
	justifyContent: "center",
	alignItems: "center"
} };
function Me({ children: e }) {
	return import_react.createElement("div", { style: Y.container }, e);
}
var $ = Me;
function Ee({ width: e, height: r, isEditorReady: n, loading: t, _ref: a, className: m, wrapperProps: E }) {
	return import_react.createElement("section", {
		style: {
			...v.wrapper,
			width: e,
			height: r
		},
		...E
	}, !n && import_react.createElement($, null, t), import_react.createElement("div", {
		ref: a,
		style: {
			...v.fullWidth,
			...!n && v.hide
		},
		className: m
	}));
}
var H = (0, import_react.memo)(Ee);
function Ce(e) {
	(0, import_react.useEffect)(e, []);
}
var k = Ce;
function he(e, r, n = !0) {
	let t = (0, import_react.useRef)(!0);
	(0, import_react.useEffect)(t.current || !n ? () => {
		t.current = !1;
	} : e, r);
}
var l = he;
function D() {}
function h(e, r, n, t) {
	return De(e, t) || be(e, r, n, t);
}
function De(e, r) {
	return e.editor.getModel(te(e, r));
}
function be(e, r, n, t) {
	return e.editor.createModel(r, n, t ? te(e, t) : void 0);
}
function te(e, r) {
	return e.Uri.parse(r);
}
function Oe({ original: e, modified: r, language: n, originalLanguage: t, modifiedLanguage: a, originalModelPath: m, modifiedModelPath: E, keepCurrentOriginalModel: g = !1, keepCurrentModifiedModel: N = !1, theme: x = "light", loading: P = "Loading...", options: y = {}, height: V = "100%", width: z = "100%", className: F, wrapperProps: j = {}, beforeMount: A = D, onMount: q = D }) {
	let [M, O] = (0, import_react.useState)(!1), [T, s] = (0, import_react.useState)(!0), u = (0, import_react.useRef)(null), c = (0, import_react.useRef)(null), w = (0, import_react.useRef)(null), d = (0, import_react.useRef)(q), o = (0, import_react.useRef)(A), b = (0, import_react.useRef)(!1);
	k(() => {
		let i = loader.init();
		return i.then((f) => (c.current = f) && s(!1)).catch((f) => f?.type !== "cancelation" && console.error("Monaco initialization: error:", f)), () => u.current ? I() : i.cancel();
	}), l(() => {
		if (u.current && c.current) {
			let i = u.current.getOriginalEditor(), f = h(c.current, e || "", t || n || "text", m || "");
			f !== i.getModel() && i.setModel(f);
		}
	}, [m], M), l(() => {
		if (u.current && c.current) {
			let i = u.current.getModifiedEditor(), f = h(c.current, r || "", a || n || "text", E || "");
			f !== i.getModel() && i.setModel(f);
		}
	}, [E], M), l(() => {
		let i = u.current.getModifiedEditor();
		i.getOption(c.current.editor.EditorOption.readOnly) ? i.setValue(r || "") : r !== i.getValue() && (i.executeEdits("", [{
			range: i.getModel().getFullModelRange(),
			text: r || "",
			forceMoveMarkers: !0
		}]), i.pushUndoStop());
	}, [r], M), l(() => {
		u.current?.getModel()?.original.setValue(e || "");
	}, [e], M), l(() => {
		let { original: i, modified: f } = u.current.getModel();
		c.current.editor.setModelLanguage(i, t || n || "text"), c.current.editor.setModelLanguage(f, a || n || "text");
	}, [
		n,
		t,
		a
	], M), l(() => {
		c.current?.editor.setTheme(x);
	}, [x], M), l(() => {
		u.current?.updateOptions(y);
	}, [y], M);
	let L = (0, import_react.useCallback)(() => {
		if (!c.current) return;
		o.current(c.current);
		let i = h(c.current, e || "", t || n || "text", m || ""), f = h(c.current, r || "", a || n || "text", E || "");
		u.current?.setModel({
			original: i,
			modified: f
		});
	}, [
		n,
		r,
		a,
		e,
		t,
		m,
		E
	]), U = (0, import_react.useCallback)(() => {
		!b.current && w.current && (u.current = c.current.editor.createDiffEditor(w.current, {
			automaticLayout: !0,
			...y
		}), L(), c.current?.editor.setTheme(x), O(!0), b.current = !0);
	}, [
		y,
		x,
		L
	]);
	(0, import_react.useEffect)(() => {
		M && d.current(u.current, c.current);
	}, [M]), (0, import_react.useEffect)(() => {
		!T && !M && U();
	}, [
		T,
		M,
		U
	]);
	function I() {
		let i = u.current?.getModel();
		g || i?.original?.dispose(), N || i?.modified?.dispose(), u.current?.dispose();
	}
	return import_react.createElement(H, {
		width: z,
		height: V,
		isEditorReady: M,
		loading: P,
		_ref: w,
		className: F,
		wrapperProps: j
	});
}
var we = (0, import_react.memo)(Oe);
function Pe() {
	let [e, r] = (0, import_react.useState)(loader.__getMonacoInstance());
	return k(() => {
		let n;
		return e || (n = loader.init(), n.then((t) => {
			r(t);
		})), () => n?.cancel();
	}), e;
}
var Le = Pe;
function He(e) {
	let r = (0, import_react.useRef)();
	return (0, import_react.useEffect)(() => {
		r.current = e;
	}, [e]), r.current;
}
var se = He;
var _ = /* @__PURE__ */ new Map();
function Ve({ defaultValue: e, defaultLanguage: r, defaultPath: n, value: t, language: a, path: m, theme: E = "light", line: g, loading: N = "Loading...", options: x = {}, overrideServices: P = {}, saveViewState: y = !0, keepCurrentModel: V = !1, width: z = "100%", height: F = "100%", className: j, wrapperProps: A = {}, beforeMount: q = D, onMount: M = D, onChange: O, onValidate: T = D }) {
	let [s, u] = (0, import_react.useState)(!1), [c, w] = (0, import_react.useState)(!0), d = (0, import_react.useRef)(null), o = (0, import_react.useRef)(null), b = (0, import_react.useRef)(null), L = (0, import_react.useRef)(M), U = (0, import_react.useRef)(q), I = (0, import_react.useRef)(), i = (0, import_react.useRef)(t), f = se(m), Q = (0, import_react.useRef)(!1), B = (0, import_react.useRef)(!1);
	k(() => {
		let p = loader.init();
		return p.then((R) => (d.current = R) && w(!1)).catch((R) => R?.type !== "cancelation" && console.error("Monaco initialization: error:", R)), () => o.current ? pe() : p.cancel();
	}), l(() => {
		let p = h(d.current, e || t || "", r || a || "", m || n || "");
		p !== o.current?.getModel() && (y && _.set(f, o.current?.saveViewState()), o.current?.setModel(p), y && o.current?.restoreViewState(_.get(m)));
	}, [m], s), l(() => {
		o.current?.updateOptions(x);
	}, [x], s), l(() => {
		!o.current || t === void 0 || (o.current.getOption(d.current.editor.EditorOption.readOnly) ? o.current.setValue(t) : t !== o.current.getValue() && (B.current = !0, o.current.executeEdits("", [{
			range: o.current.getModel().getFullModelRange(),
			text: t,
			forceMoveMarkers: !0
		}]), o.current.pushUndoStop(), B.current = !1));
	}, [t], s), l(() => {
		let p = o.current?.getModel();
		p && a && d.current?.editor.setModelLanguage(p, a);
	}, [a], s), l(() => {
		g !== void 0 && o.current?.revealLine(g);
	}, [g], s), l(() => {
		d.current?.editor.setTheme(E);
	}, [E], s);
	let X = (0, import_react.useCallback)(() => {
		if (!(!b.current || !d.current) && !Q.current) {
			U.current(d.current);
			let p = m || n, R = h(d.current, t || e || "", r || a || "", p || "");
			o.current = d.current?.editor.create(b.current, {
				model: R,
				automaticLayout: !0,
				...x
			}, P), y && o.current.restoreViewState(_.get(p)), d.current.editor.setTheme(E), g !== void 0 && o.current.revealLine(g), u(!0), Q.current = !0;
		}
	}, [
		e,
		r,
		n,
		t,
		a,
		m,
		x,
		P,
		y,
		E,
		g
	]);
	(0, import_react.useEffect)(() => {
		s && L.current(o.current, d.current);
	}, [s]), (0, import_react.useEffect)(() => {
		!c && !s && X();
	}, [
		c,
		s,
		X
	]), i.current = t, (0, import_react.useEffect)(() => {
		s && O && (I.current?.dispose(), I.current = o.current?.onDidChangeModelContent((p) => {
			B.current || O(o.current.getValue(), p);
		}));
	}, [s, O]), (0, import_react.useEffect)(() => {
		if (s) {
			let p = d.current.editor.onDidChangeMarkers((R) => {
				let G = o.current.getModel()?.uri;
				if (G && R.find((J) => J.path === G.path)) {
					let J = d.current.editor.getModelMarkers({ resource: G });
					T?.(J);
				}
			});
			return () => {
				p?.dispose();
			};
		}
		return () => {};
	}, [s, T]);
	function pe() {
		I.current?.dispose(), V ? y && _.set(m, o.current.saveViewState()) : o.current.getModel()?.dispose(), o.current.dispose();
	}
	return import_react.createElement(H, {
		width: z,
		height: F,
		isEditorReady: s,
		loading: N,
		_ref: b,
		className: j,
		wrapperProps: A
	});
}
var de = (0, import_react.memo)(Ve);
var Ft = de;
//#endregion
export { we as DiffEditor, de as Editor, Ft as default, loader, Le as useMonaco };

//# sourceMappingURL=@monaco-editor_react.js.map