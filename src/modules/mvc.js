/**
 * mvc 模块
 * @author leochen
 */
(function (Q) {
	var win = Q.global,
		isNull = Q.isNull,
		isPlainObject = Q.isPlainObject,
		execCatch = Q.execCatch,
		extend = Q.extend,
		each = Q.each,
		delay = Q.delay,
		con = console;

	var ctrls = {}, //控制器存储
		scopes = {},
		g_config = {
			section: 24//q-for分隔大小
		},
		keywords = "scopes context parent get set on off once app watch apply $";//关键词,用户不能定义到scope上的变量名
	var nameParentScope = "parent",
		namespace = "qmik-mvc-space",
		namespaceScope = "qmik-mvc-space-scope",
		fieldWatchs = "__watchs",
		nameRoot = "html",
		nameContext = "context",
		nameInput = "__input",
		nameMap = "__map",
		execInterval = 10;//scroll触发间隔
	/********* 当节点在显示视口时触发 start *******/
	var g_viewports = {};

	var prevTime = Q.now();

	function handle() {
		var curTime = Q.now();
		if (curTime - prevTime < execInterval) {//触发频率
			delay(handle, execInterval + 2);
			return;
		}
		prevTime = curTime;
		var map = extend({}, g_viewports);
		each(map, function (key, map) {
			var node = map.scope ? map.scope.context : map.context,
				qdom = Q(node);
			if (qdom.inViewport()) {
				delete g_viewports[key];
				Q.delay(function () {
					execCatch(map.callback);
					qdom.emit("viewport");
				}, 11);
			}
		});
	}

	Q(win).on({
		scroll: handle,
		touchstart: handle,
		touchmove: handle
	});
	function trigger() {
		Q(win).emit("scroll");
	}

	/********* 当节点在显示视口时触发 end *******/
	//监听器的触发实现
	function watch(e, scope, emit) {
		var target = e.target,
			name = emit ? e.name : target.name || "",
			scope = getCtrlNode(target)[namespaceScope] || scope;
		scope = getUseSpaceScope(scope, name);
		if (name && (isInput(target) || emit)) {
			fieldValue(scope, name, emit ? e.value : getInputValue(target));
			var value = getVarValue(scope, name);

			if (!isMulInput(target)) {
				//检测新老值的变化
				if (target.__oldValue == value) return;
				target.__oldValue = value;
			}

			/* 如果是根scope,那么 把值赋值到 Scope.prototype 上面, 采用原型模式来读取内容 */
			setScopePrototype(scope, name);

			each(getBatList(scope[fieldWatchs], name), function (i, watch) {
				execCatch(watch, [{name: name, value: value, source: scope[split(name)[0]], target: target}]);
			});
			compileVarName(name, scope);
		}
	}

	var globalScope;//全局scope
	/** 应用 */
	function App(config) {
		this.config(config);
		this._rootCtrls = [];
	}

	extend(App.prototype, {
		__init: function (fun) {
			var me = this,
				scope = new Scope(),
				root = Q(nameRoot)[0];
			globalScope = me.scope = scope;
			root[namespace] = getSpace(root);
			Q.each(me._rootCtrls, function (i, fuun) {
				fuun.call(scope, scope);
			});
			me._rootCtrls = [];
			Q.isFun(fun) && fun.call(scope, scope);

			function remove(e) {
				var target = e.target,
					name = target.name,
					isInputDom = isInput(target),
					space = getSpace(target);
				if (space) {
					var scope = space.scope;
					each(space.vars, function (i, _name) {
						var newmaps = [];
						if (isInputDom && name == _name) {
							return;
						}
						each(scope[nameMap][_name], function (i, dom) {
							dom != target && newmaps.push(dom);
						});
						scope[nameMap][_name] = newmaps;
					});
					if (isInputDom) {
						/^\s*$/.test(target.value || '') || updateInputDomValue(scope, name);
						//delay(updateInputDomsLevelValue,10, scope,name)
					}
				}
			}

			function _change(e) {
				watch(e, scope);
			}

			Q("body").on({
				change: _change,
				keyup: _change
			});
			Q(win).on({
				//DOMSubtreeModified: function(e){},
				DOMNodeInserted: function (e) {//节点增加
					var target = e.target,
						space = getSpace(target),
						scope = space.scope;
					if (space) {
						if (isInput(target) && /^\s*$/.test(target.value || '')) {
							return;
						}
						delay(function () {
							var ctrl = Q(target).closest('[q-ctrl]')[0];
							addScopeInput(target, ctrl ? scope : globalScope);
							queryInputs(target, function (dom) {
								if (isInput(dom)) {
									addScopeInput(dom, ctrl ? scope : globalScope);
									ctrl || globalScope.apply(dom.name);
								}
							});
							compile(target, scope, true);
						}, 30)
					}
				},
				DOMNodeRemoved: remove //删除节点
			});

			scope.apply("");
			compile(root, scope, true);//编译页面
			trigger();
		},
		config: function (map) {
			extend(g_config, map);
			return g_config;
		},
		//控制器
		ctrl: function (name, callback) {
			if (arguments.length < 1) {
				return ctrls;
			}
			if (isPlainObject(name)) {
				extend(ctrls, name)
			} else {
				ctrls[name] = callback;
			}
			return this;
		}
	});

	/** 会话 */
	function Scope(context, rootScope) {
		var me = this;
		me[fieldWatchs] = {}; //监听器集合
		me[nameContext] = context = context || Q(nameRoot)[0]; //上文dom节点
		me.scopes = scopes;
		me.__name = Q(context).attr("q-ctrl") || "root"; //控制器名
		me[nameMap] = {}; //变量映射节点集合
		me.__cmd = {}; //预留
		me[nameInput] = {}; //input映射节点
		scopes[me.__name] = me;
		context[namespaceScope] = me;
		me[nameParentScope] = rootScope; //父scope
		addScopeInputs(me[nameContext], me);
	}

	var ScopePrototype = Scope.prototype;
	extend(ScopePrototype, {
		// 监控器,监控变量
		watch: function (name, callback) {
			var me = this, map = {};
			if (isPlainObject(name)) {
				map = name;
			} else {
				map[name] = callback;
			}
			each(map, function (name, value) {
				me[fieldWatchs][name] = me[fieldWatchs][name] || [];
				me[fieldWatchs][name].push(value);
			});
			return me;
		},
		/**
		 查询节点,在控制器下的范围内查询
		 */
		'$': function (selector) {
			return isNull(selector) ? Q(this[nameContext]) : Q(selector, this[nameContext]);
		},
		on: function (name, handle) {
			Q(this[nameContext]).on(name, handle)
		},
		off: function (name, handle) {
			Q(this[nameContext]).off(name, handle)
		},
		once: function (name, handle) {
			Q(this[nameContext]).once(name, handle)
		},
		set: function (name, value, callback) {
			var nameList = [];
			var me = this;
			if (Q.isPlainObject(name)) {
				callback = value;
				Q.each(name, function (key, val) {
					nameList.push(key);
					fieldValue(me, key, val);
				})
			} else {
				nameList = [name];
				fieldValue(me, name, value);
			}
			me.apply(nameList, callback);
			return me;
		},
		get: function (name) {
			return fieldValue(this, name)
		},
		apply: function (names, callback) { //应用会话信息的变更,同时刷新局部页面
			var me = this;
			if (Q.isFun(names)) {
				callback = names;
				names = [];
			} else {
				names = Q.isArray(names) ? names : Q.isString(names) ? [names] : [];
			}
			//合并之前的更新 名册
			names = uniqueArray(names, (g_viewports[me.__name] || {}).names);
			updateGlobalScope(me);
			var tasks = (g_viewports[me.__name] || {}).tasks || [];
			tasks.push(function (cb) {
				Q.execCatch(callback);
				cb && cb();
			});
			g_viewports[me.__name] = {
				scope: me,
				names: names,
				tasks: tasks,
				callback: function () {
					function emitChange(names, callback) {
						var isArray = Q.likeArray(names), name;
						each(names, function (i, list) {
							name = isArray ? list : i;
							updateInputDomsLevelValue(me, name);
							watch({
								target: me[nameContext],
								name: name,
								value: me[name]
							}, me, true);
							callback && callback(name, me);
						});
					}

					if (names.length < 1) {
						names = [];
						each(me[nameMap], function (key, value) {
							names.push(key);
						});
					}

					emitChange(names, compileVarName);
					//Q.isFun(callback) && callback();
					Q.series(tasks);
				}
			};
			delay(handle, execInterval + 2);
		}
	});
	/** 更新全局 */
	function updateGlobalScope(scope) {
		if (scope == globalScope) {
			for (var name in scope) {
				if (ScopePrototype[name] != scope[name] && !isIllegalName(name)) {
					ScopePrototype[name] = scope[name];
				}
			}
		}
	}

	/** 是否是非法的变量名(往scope赋值) */
	function isIllegalName(name) {
		return /^__/.test(name) || new RegExp(name).test(keywords)
	}

	function queryInputs(context, callback) {
		context.nodeType == 1 && $('input,select,textarea', context).each(function (i, dom) {
			callback && callback(dom);
		});
	}

	function addScopeInputs(context, scope) {
		/*context.nodeType==1 && $("input,select,textarea", context).each(function(i, dom) {
		 var pctrl = Q(dom).closest("[q-ctrl]")[0];
		 (isNull(pctrl)||pctrl==context) && addScopeInput(dom, scope);
		 });*/
		queryInputs(context, function (dom) {
			var pctrl = Q(dom).closest("[q-ctrl]")[0];
			(isNull(pctrl) || pctrl == context) && addScopeInput(dom, scope);
		})
	}

	function addScopeInput(dom, scope) {
		var name = dom.name;
		if (isInput(dom) && name) {
			if (isIllegalName(name)) {
				return Q.error("set scope[" + scope.__name + "] name[" + name + "] is illegal");
			}
			scope = getUseSpaceScope(scope, name);
			var val = getInputValue(dom);
			if (isMulInput(dom)) {
				val = val || fieldValue(scope, name);
			}
			fieldValue(scope, name, val);
			//scope[nameInput][name] = dom;
			scope[nameInput][name] = scope[nameInput][name] || [];
			scope[nameInput][name].push(dom);

			/* 如果是根scope,那么 把值赋值到 ScopePrototype 上面, 采用原型模式来读取内容 */
			setScopePrototype(scope, name);

		}
	}

	/* 如果是根scope,那么 把值赋值到 ScopePrototype 上面, 采用原型模式来读取内容 */
	function setScopePrototype(scope, name) {
		if (scope.__name == "root") {//如果是根scope
			var field = split(name)[0];
			ScopePrototype[field] = scope[field];
		}
	}

	function uniqueArray(list1, list2) {
		if (list1.length < 1)return [];
		var list = list1.concat(list2 || []).sort(),
			result = [];
		for (var i = 0, j; i < list.length; i++) {
			for (j = i + 1; j < list.length; j++) {
				if (new RegExp("^" + list[i]).test(list[j])) {
					list.splice(j, 1);
					j--;
				}
			}
			result[i] = list[i];
		}
		return result;
	}

	function getBatList(map, name) {
		if (name == "")return;
		var retWatchs = [];
		for (var i = 0, end = split(name).length; i < end; i++) {
			var watch = map[name];
			if (watch) {
				retWatchs = watch.concat(retWatchs);
			}
			name = name.replace(/\.?[^\.]*$/, "");
		}
		return retWatchs;
	}

	function isInput(dom) {
		var name = dom ? dom.tagName : "";
		return name == "INPUT" || name == "SELECT" || name == "TEXTAREA"
	}

	function isMulInput(dom) {
		var type = dom.type;
		return type == "checkbox" || type == "radio" || type == "select-multiple"
	}

	/** 取界面上input输入标签的初始化值 */
	function getInputValue(node) {
		var name = node.name,
			type = node.type,
			vals = [];
		if (type == "radio") {
			vals[0] = node.checked ? node.value : ""
		} else if (type == "checkbox") {
			Q("input[name='" + node.name + "']", getCtrlNode(node)).each(function (i, dom) {
				dom.checked && vals.push(dom.value)
			})
		} else if (type == "select-multiple") {
			Q(node).children("option").each(function (i, option) {
				option && option.selected && vals.push(option.value)
			});
		} else {
			vals.push(node.value)
		}
		return vals.join("&")
	}

	var REG_VAR_NAME = /(\$\{\s*[\w\._-]*\s*\})|(\{\{\s*[\w\._-]*\s*\}\})/g;
	var REG_VAR_NAME_REP = /\s*((^(\$|\{)\{)|(\}?\}$))\s*/g;
	var REG_SCRIPT = /<\s*script/g;

	REG_VAR_NAME.compile(REG_VAR_NAME);
	REG_VAR_NAME_REP.compile(REG_VAR_NAME_REP);
	REG_SCRIPT.compile(REG_SCRIPT);

	/** 解析页面 */
	function compile(node, scope, isAdd) {
		replaceNodeVar(node, scope, isAdd, compileChilds);
	}

	function compileChilds(node, scope, isAdd) {
		if (node && node != win) {
			each(node.childNodes, function (i, node) {
				replaceNodeVar(node, scope, isAdd, compileChilds);
			})
		}
	}

	//取得变量名
	function getVarName(name) {
		return (name || "").replace(REG_VAR_NAME_REP, "");
	}

	function split(name) {
		return name.split(".")
	}

	function fieldValue(object, names, val) {
		var ns = Q.isArray(names) ? names : split(names),
			field = ns[0];
		if (ns.length < 2) {
			if (!isNull(val)) {
				object[field] = !isNull(val) ? val : !isNull(object[field]) ? object[field] : "";
			}
			return object[field];
		}
		object[field] = object[field] || {};
		ns.shift();
		return fieldValue(object[field], ns, val);
	}

	//取变量对应的值
	function getVarValue(scope, name) {
		var val = fieldValue(getUseSpaceScope(scope, name), name);
		return isNull(val) ? "" : val;
	}

	function getUseSpaceScope(scope, name) {
		var field = split(name)[0];
		//return isNull(scope[field]) && scope[nameParentScope] && !isNull(scope[nameParentScope][field]) ? scope[nameParentScope] : scope
		var val1 = scope[field];
		var val2 = ScopePrototype[field];
		if (!isNull(val2)) {//全局不为空
			if (Q.isObject(val1) || Q.isArray(val1)) {
				if (val1 == val2) {
					return scope[nameParentScope] ? scope[nameParentScope] : scope;
				}
			}
		}
		return scope;
	}

	/** 取控制器节点 */
	function getCtrlNode(node) {
		return Q(node).closest("[q-ctrl]," + nameRoot)[0]
	}

	//添加变量映射节点
	function addMapNode(scope, name, node) {
		scope = getUseSpaceScope(scope, name);
		if (scope) {
			addMapPush(scope, name, node)
		}
	}

	function addMapPush(scope, name, node) {
		var retWatchs = [];
		for (var i = 0, end = split(name).length; i < end; i++) {
			var list = scope[nameMap][name] = scope[nameMap][name] || [];
			list.indexOf(node) < 0 && list.push(node);
			name = name.replace(/\.?[^\.]*$/, "");
		}
		return retWatchs;
	}

	function compileVarName(key, scope) {
		var list = [];
		each(scope[nameMap][key], function (i, dom) {
			if (Q(dom).parents("html").length > 0) {
				list.push(dom);
			}
			replaceNodeVar(dom, scope);
		});
		scope[nameMap][key] = list;
	}

	/** 取存放到节点上的对象空间 */
	function getSpace(node) {
		var ctrl = getCtrlNode(node);
		if (ctrl) {
			return node[namespace] || {
					attr: {},
					vars: [],
					ctrl: ctrl,
					event: {},
					fors: {},
					scope: ctrl[namespaceScope] || globalScope
				}
		}
	}

	/** 更新级联的输入节点 ,依赖于updateInputDomValue */
	function updateInputDomsLevelValue(scope, name) {
		each(scope[nameInput], function (key) {
			if (key == name || key.indexOf(name + ".") == 0) {
				updateInputDomValue(scope, key);
			}
		});
	}

	function updateInputDomValue(scope, name) {
		var newValue = getVarValue(scope, name) + "";
		var list = scope[nameInput][name];
		scope[nameInput][name] = [];
		each(list, function (i, dom) {
			if (Q.contains(scope.context, dom)) {
				var type = dom.type;
				if (type == 'radio') {
					dom.checked = dom.value == newValue;
				} else if (type == 'checkbox') {
					dom.checked = false;
					newValue.replace(/[^&]+/g, function (val) {
						if (dom.value == val) {
							dom.checked = true;
						}
					});
				} else if (type == 'select-multiple') {
					each(dom.options, function (j, ele) {
						ele.selected = false;
						newValue.replace(/[^&]+/g, function (val) {
							if (ele.value == val) {
								ele.selected = true;
							}
						});
					});
				} else {
					dom.value = newValue;
				}
				scope[nameInput][name].push(dom);
			}
		});
	}

	function replaceNodeVar(node, scope, isAdd, callback) {
		var space = getSpace(node), qnode = Q(node);
		if (!space)return;
		switch (node.nodeType) {
			case 1://正常节点
				node.tagName != "SCRIPT" && each(node.attributes, function (i, attr) {
					var attrName = attr.name,//属性名
						value = space.attr[attrName] = space.attr[attrName] || (attr.value || "").trim();
					if ("q-ctrl" == attrName) {//控制器
						if (value != "") {
							if (scopes[value]) {
								scope = scopes[value];
							} else {
								scope = new Scope(node, scope.parent || scope);
								execCatch(function () {
									Q.isFun(ctrls[value]) ? ctrls[value].call(scope, scope) : Q.warn("q-ctrl:[" + value + "]is not define");
								});
								scope.apply("");
							}
						}
					} else if ("q-include" == attrName) {
						var vpkey = "q-include-" + value + Math.random(), vphandle = {
							context: node,
							callback: function () {
								if (Q(node).css('display') != 'none') {
									Q.get(value, function (html) {
										qnode.rmClass('loading').html('<div>' + html + '</div>');
									})
								} else {
									g_viewports[vpkey] = vphandle;
									Q('body').once({
										click: handle,
										touchstart: handle
									})
								}
							}
						};
						g_viewports[vpkey] = vphandle;
						qnode.rmAttr("q-include");
					} else if ("q-for" == attrName) { //for
						var vs = value.replace(/(\s){2,}/g, " ").split(" "),
							template = space.html = space.html || node.innerHTML.replace(REG_SCRIPT, "&lt;script"),
							htmls = [],
							list = getVarValue(scope, vs[2]) || [];
						if (vs.length == 3 && vs[1] == "in") {
							each(list, function (i, item) {
								var html = template.replace(REG_VAR_NAME, function (varName) {
									var reg = new RegExp("^" + vs[0] + "\."),
										name = getVarName(varName).replace(reg, ""),
										val = fieldValue(item, name);
									val = isNull(val) ? "" : val + "";
									return val.replace(REG_SCRIPT, "&lt;script");
								});
								htmls.push(html);
							});
							qnode.html(htmls.join(""));
							compileChilds(node, scope, isAdd);//编译
							show(node);
							node[namespace] = space;
							isAdd && addMapNode(scope, vs[2], node);
						} else {
							Q.warn("q-for[", value, "] is error");
						}
					} else if (/^q-on/.test(attrName)) {//事件绑定
						var name = attrName.replace(/^q-on/, ""),
							funName = value.replace(/\(.*\)$/, ""),
							context = scope[nameContext];
						if (!space.event[name]) {
							node[namespace] = space;
							if (["focus", "blur"].indexOf(name) >= 0) {
								context = node;
							} else {
								space.event[name] = true;
							}
							var innerhandle = function (e) {
								if (!Q.contains(context, node)) {
									return Q(context).off(name, innerhandle);
								}
								if (Q.contains(node, e.target)) {//判断是否是当前节点的子节点触发的事件
									scope[funName] && scope[funName].call(node, e);
								}
							};
							Q(context).on(name, innerhandle);
						}
					} else if (REG_VAR_NAME.test(value)) {//变量
						attr.value = value.replace(REG_VAR_NAME, function (name) {
							node[namespace] = space;
							name = getVarName(name);
							space.vars.push(name);
							var val = getVarValue(scope, name);
							isAdd && addMapNode(scope, name, node);
							return val;
						});
					}
				});
				break;
			case 3://文本节点
				var textValue = space.text;
				textValue = isNull(textValue) ? node.textContent : textValue;
				if (REG_VAR_NAME.test(textValue)) {
					node[namespace] = space;
					space.text = textValue;
					node.textContent = textValue.replace(REG_VAR_NAME, function (name) {
						name = getVarName(name);
						space.vars.push(name);
						var val = getVarValue(scope, name);
						isAdd && addMapNode(scope, name, node);
						//updateInputDomValue(scope,name);
						return val;
					});
					show(node.parentNode);
				}
				break;
		}
		space.scope = scope;
		callback && callback(node, scope, isAdd);
	}

	function show(node) {
		var qnode = Q(node);
		qnode.css("visibility", "visible");
		if (qnode.css('display') == 'none') {
			if (Q.isIE()) {
				qnode.css('display', qnode.attr('q-for') ? 'inline-block' : 'inline');
			} else {
				qnode.css('display', 'initial');
			}
		}
	}

	var app;
	Q.app = function (rootCtrlFun, config) {
		config = Q.isFun(rootCtrlFun) ? config : rootCtrlFun;
		config = Q.isObject(config) ? config : {};

		app = app || new App(config);
		if (config.compile != false && !app.compile) {
			app.compile = true;
			Q(function () {
				app.__init(rootCtrlFun);
			})
		} else if (Q.isFun(rootCtrlFun)) {
			if (app.scope) {
				execCatch(rootCtrlFun, [app.scope]);
			} else {
				app._rootCtrls.push(rootCtrlFun);
			}
		}
		return app;
	};
	//
})(Qmik);