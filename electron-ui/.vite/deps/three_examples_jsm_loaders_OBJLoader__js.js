import { Bs as Vector3, Nr as LineSegments, Or as LineBasicMaterial, To as SRGBColorSpace, Ur as Loader, Xr as Material, Y as BufferGeometry, ca as Points, ct as Color, di as MeshPhongMaterial, ii as Mesh, la as PointsMaterial, xn as Float32BufferAttribute, yn as FileLoader, zn as Group } from "./three.module-U45zLmMV.js";
//#region node_modules/three/examples/jsm/loaders/OBJLoader.js
var _object_pattern = /^[og]\s*(.+)?/;
var _material_library_pattern = /^mtllib /;
var _material_use_pattern = /^usemtl /;
var _map_use_pattern = /^usemap /;
var _face_vertex_data_separator_pattern = /\s+/;
var _vA = new Vector3();
var _vB = new Vector3();
var _vC = new Vector3();
var _ab = new Vector3();
var _cb = new Vector3();
var _color = new Color();
function ParserState() {
	const state = {
		objects: [],
		object: {},
		vertices: [],
		normals: [],
		colors: [],
		uvs: [],
		materials: {},
		materialLibraries: [],
		startObject: function(name, fromDeclaration) {
			if (this.object && this.object.fromDeclaration === false) {
				this.object.name = name;
				this.object.fromDeclaration = fromDeclaration !== false;
				return;
			}
			const previousMaterial = this.object && typeof this.object.currentMaterial === "function" ? this.object.currentMaterial() : void 0;
			if (this.object && typeof this.object._finalize === "function") this.object._finalize(true);
			this.object = {
				name: name || "",
				fromDeclaration: fromDeclaration !== false,
				geometry: {
					vertices: [],
					normals: [],
					colors: [],
					uvs: [],
					hasUVIndices: false
				},
				materials: [],
				smooth: true,
				startMaterial: function(name, libraries) {
					const previous = this._finalize(false);
					if (previous && (previous.inherited || previous.groupCount <= 0)) this.materials.splice(previous.index, 1);
					const material = {
						index: this.materials.length,
						name: name || "",
						mtllib: Array.isArray(libraries) && libraries.length > 0 ? libraries[libraries.length - 1] : "",
						smooth: previous !== void 0 ? previous.smooth : this.smooth,
						groupStart: previous !== void 0 ? previous.groupEnd : 0,
						groupEnd: -1,
						groupCount: -1,
						inherited: false,
						clone: function(index) {
							const cloned = {
								index: typeof index === "number" ? index : this.index,
								name: this.name,
								mtllib: this.mtllib,
								smooth: this.smooth,
								groupStart: 0,
								groupEnd: -1,
								groupCount: -1,
								inherited: false
							};
							cloned.clone = this.clone.bind(cloned);
							return cloned;
						}
					};
					this.materials.push(material);
					return material;
				},
				currentMaterial: function() {
					if (this.materials.length > 0) return this.materials[this.materials.length - 1];
				},
				_finalize: function(end) {
					const lastMultiMaterial = this.currentMaterial();
					if (lastMultiMaterial && lastMultiMaterial.groupEnd === -1) {
						lastMultiMaterial.groupEnd = this.geometry.vertices.length / 3;
						lastMultiMaterial.groupCount = lastMultiMaterial.groupEnd - lastMultiMaterial.groupStart;
						lastMultiMaterial.inherited = false;
					}
					if (end && this.materials.length > 1) {
						for (let mi = this.materials.length - 1; mi >= 0; mi--) if (this.materials[mi].groupCount <= 0) this.materials.splice(mi, 1);
					}
					if (end && this.materials.length === 0) this.materials.push({
						name: "",
						smooth: this.smooth
					});
					return lastMultiMaterial;
				}
			};
			if (previousMaterial && previousMaterial.name && typeof previousMaterial.clone === "function") {
				const declared = previousMaterial.clone(0);
				declared.inherited = true;
				this.object.materials.push(declared);
			}
			this.objects.push(this.object);
		},
		finalize: function() {
			if (this.object && typeof this.object._finalize === "function") this.object._finalize(true);
		},
		parseVertexIndex: function(value, len) {
			const index = parseInt(value, 10);
			return (index >= 0 ? index - 1 : index + len / 3) * 3;
		},
		parseNormalIndex: function(value, len) {
			const index = parseInt(value, 10);
			return (index >= 0 ? index - 1 : index + len / 3) * 3;
		},
		parseUVIndex: function(value, len) {
			const index = parseInt(value, 10);
			return (index >= 0 ? index - 1 : index + len / 2) * 2;
		},
		addVertex: function(a, b, c) {
			const src = this.vertices;
			const dst = this.object.geometry.vertices;
			dst.push(src[a + 0], src[a + 1], src[a + 2]);
			dst.push(src[b + 0], src[b + 1], src[b + 2]);
			dst.push(src[c + 0], src[c + 1], src[c + 2]);
		},
		addVertexPoint: function(a) {
			const src = this.vertices;
			this.object.geometry.vertices.push(src[a + 0], src[a + 1], src[a + 2]);
		},
		addVertexLine: function(a) {
			const src = this.vertices;
			this.object.geometry.vertices.push(src[a + 0], src[a + 1], src[a + 2]);
		},
		addNormal: function(a, b, c) {
			const src = this.normals;
			const dst = this.object.geometry.normals;
			dst.push(src[a + 0], src[a + 1], src[a + 2]);
			dst.push(src[b + 0], src[b + 1], src[b + 2]);
			dst.push(src[c + 0], src[c + 1], src[c + 2]);
		},
		addFaceNormal: function(a, b, c) {
			const src = this.vertices;
			const dst = this.object.geometry.normals;
			_vA.fromArray(src, a);
			_vB.fromArray(src, b);
			_vC.fromArray(src, c);
			_cb.subVectors(_vC, _vB);
			_ab.subVectors(_vA, _vB);
			_cb.cross(_ab);
			_cb.normalize();
			dst.push(_cb.x, _cb.y, _cb.z);
			dst.push(_cb.x, _cb.y, _cb.z);
			dst.push(_cb.x, _cb.y, _cb.z);
		},
		addColor: function(a, b, c) {
			const src = this.colors;
			const dst = this.object.geometry.colors;
			if (src[a] !== void 0) dst.push(src[a + 0], src[a + 1], src[a + 2]);
			if (src[b] !== void 0) dst.push(src[b + 0], src[b + 1], src[b + 2]);
			if (src[c] !== void 0) dst.push(src[c + 0], src[c + 1], src[c + 2]);
		},
		addUV: function(a, b, c) {
			const src = this.uvs;
			const dst = this.object.geometry.uvs;
			dst.push(src[a + 0], src[a + 1]);
			dst.push(src[b + 0], src[b + 1]);
			dst.push(src[c + 0], src[c + 1]);
		},
		addDefaultUV: function() {
			const dst = this.object.geometry.uvs;
			dst.push(0, 0);
			dst.push(0, 0);
			dst.push(0, 0);
		},
		addUVLine: function(a) {
			const src = this.uvs;
			this.object.geometry.uvs.push(src[a + 0], src[a + 1]);
		},
		addFace: function(a, b, c, ua, ub, uc, na, nb, nc) {
			const vLen = this.vertices.length;
			let ia = this.parseVertexIndex(a, vLen);
			let ib = this.parseVertexIndex(b, vLen);
			let ic = this.parseVertexIndex(c, vLen);
			this.addVertex(ia, ib, ic);
			this.addColor(ia, ib, ic);
			if (na !== void 0 && na !== "") {
				const nLen = this.normals.length;
				ia = this.parseNormalIndex(na, nLen);
				ib = this.parseNormalIndex(nb, nLen);
				ic = this.parseNormalIndex(nc, nLen);
				this.addNormal(ia, ib, ic);
			} else this.addFaceNormal(ia, ib, ic);
			if (ua !== void 0 && ua !== "") {
				const uvLen = this.uvs.length;
				ia = this.parseUVIndex(ua, uvLen);
				ib = this.parseUVIndex(ub, uvLen);
				ic = this.parseUVIndex(uc, uvLen);
				this.addUV(ia, ib, ic);
				this.object.geometry.hasUVIndices = true;
			} else this.addDefaultUV();
		},
		addPointGeometry: function(vertices) {
			this.object.geometry.type = "Points";
			const vLen = this.vertices.length;
			for (let vi = 0, l = vertices.length; vi < l; vi++) {
				const index = this.parseVertexIndex(vertices[vi], vLen);
				this.addVertexPoint(index);
				this.addColor(index);
			}
		},
		addLineGeometry: function(vertices, uvs) {
			this.object.geometry.type = "Line";
			const vLen = this.vertices.length;
			const uvLen = this.uvs.length;
			for (let vi = 0, l = vertices.length; vi < l; vi++) this.addVertexLine(this.parseVertexIndex(vertices[vi], vLen));
			for (let uvi = 0, l = uvs.length; uvi < l; uvi++) this.addUVLine(this.parseUVIndex(uvs[uvi], uvLen));
		}
	};
	state.startObject("", false);
	return state;
}
/**
* A loader for the OBJ format.
*
* The [OBJ format](https://en.wikipedia.org/wiki/Wavefront_.obj_file) is a simple data-format that
* represents 3D geometry in a human readable format as the position of each vertex, the UV position of
* each texture coordinate vertex, vertex normals, and the faces that make each polygon defined as a list
* of vertices, and texture vertices.
*
* ```js
* const loader = new OBJLoader();
* const object = await loader.loadAsync( 'models/monster.obj' );
* scene.add( object );
* ```
*
* @augments Loader
* @three_import import { OBJLoader } from 'three/addons/loaders/OBJLoader.js';
*/
var OBJLoader = class extends Loader {
	/**
	* Constructs a new OBJ loader.
	*
	* @param {LoadingManager} [manager] - The loading manager.
	*/
	constructor(manager) {
		super(manager);
		/**
		* A reference to a material creator.
		*
		* @type {?MaterialCreator}
		* @default null
		*/
		this.materials = null;
	}
	/**
	* Starts loading from the given URL and passes the loaded OBJ asset
	* to the `onLoad()` callback.
	*
	* @param {string} url - The path/URL of the file to be loaded. This can also be a data URI.
	* @param {function(Group)} onLoad - Executed when the loading process has been finished.
	* @param {onProgressCallback} onProgress - Executed while the loading is in progress.
	* @param {onErrorCallback} onError - Executed when errors occur.
	*/
	load(url, onLoad, onProgress, onError) {
		const scope = this;
		const loader = new FileLoader(this.manager);
		loader.setPath(this.path);
		loader.setRequestHeader(this.requestHeader);
		loader.setWithCredentials(this.withCredentials);
		loader.load(url, function(text) {
			try {
				onLoad(scope.parse(text));
			} catch (e) {
				if (onError) onError(e);
				else console.error(e);
				scope.manager.itemError(url);
			}
		}, onProgress, onError);
	}
	/**
	* Sets the material creator for this OBJ. This object is loaded via {@link MTLLoader}.
	*
	* @param {MaterialCreator} materials - An object that creates the materials for this OBJ.
	* @return {OBJLoader} A reference to this loader.
	*/
	setMaterials(materials) {
		this.materials = materials;
		return this;
	}
	/**
	* Parses the given OBJ data and returns the resulting group.
	*
	* @param {string} text - The raw OBJ data as a string.
	* @return {Group} The parsed OBJ.
	*/
	parse(text) {
		const state = new ParserState();
		if (text.indexOf("\r\n") !== -1) text = text.replace(/\r\n/g, "\n");
		if (text.indexOf("\\\n") !== -1) text = text.replace(/\\\n/g, "");
		const lines = text.split("\n");
		let result = [];
		for (let i = 0, l = lines.length; i < l; i++) {
			const line = lines[i].trimStart();
			if (line.length === 0) continue;
			const lineFirstChar = line.charAt(0);
			if (lineFirstChar === "#") continue;
			if (lineFirstChar === "v") {
				const data = line.split(_face_vertex_data_separator_pattern);
				switch (data[0]) {
					case "v":
						state.vertices.push(parseFloat(data[1]), parseFloat(data[2]), parseFloat(data[3]));
						if (data.length >= 7) {
							_color.setRGB(parseFloat(data[4]), parseFloat(data[5]), parseFloat(data[6]), SRGBColorSpace);
							state.colors.push(_color.r, _color.g, _color.b);
						} else state.colors.push(void 0, void 0, void 0);
						break;
					case "vn":
						state.normals.push(parseFloat(data[1]), parseFloat(data[2]), parseFloat(data[3]));
						break;
					case "vt":
						state.uvs.push(parseFloat(data[1]), parseFloat(data[2]));
						break;
				}
			} else if (lineFirstChar === "f") {
				const vertexData = line.slice(1).trim().split(_face_vertex_data_separator_pattern);
				const faceVertices = [];
				for (let j = 0, jl = vertexData.length; j < jl; j++) {
					const vertex = vertexData[j];
					if (vertex.length > 0) {
						const vertexParts = vertex.split("/");
						faceVertices.push(vertexParts);
					}
				}
				const v1 = faceVertices[0];
				for (let j = 1, jl = faceVertices.length - 1; j < jl; j++) {
					const v2 = faceVertices[j];
					const v3 = faceVertices[j + 1];
					state.addFace(v1[0], v2[0], v3[0], v1[1], v2[1], v3[1], v1[2], v2[2], v3[2]);
				}
			} else if (lineFirstChar === "l") {
				const lineParts = line.substring(1).trim().split(" ");
				let lineVertices = [];
				const lineUVs = [];
				if (line.indexOf("/") === -1) lineVertices = lineParts;
				else for (let li = 0, llen = lineParts.length; li < llen; li++) {
					const parts = lineParts[li].split("/");
					if (parts[0] !== "") lineVertices.push(parts[0]);
					if (parts[1] !== "") lineUVs.push(parts[1]);
				}
				state.addLineGeometry(lineVertices, lineUVs);
			} else if (lineFirstChar === "p") {
				const pointData = line.slice(1).trim().split(" ");
				state.addPointGeometry(pointData);
			} else if ((result = _object_pattern.exec(line)) !== null) {
				const name = (" " + result[0].slice(1).trim()).slice(1);
				state.startObject(name);
			} else if (_material_use_pattern.test(line)) state.object.startMaterial(line.substring(7).trim(), state.materialLibraries);
			else if (_material_library_pattern.test(line)) state.materialLibraries.push(line.substring(7).trim());
			else if (_map_use_pattern.test(line)) console.warn("THREE.OBJLoader: Rendering identifier \"usemap\" not supported. Textures must be defined in MTL files.");
			else if (lineFirstChar === "s") {
				result = line.split(" ");
				if (result.length > 1) {
					const value = result[1].trim().toLowerCase();
					state.object.smooth = value !== "0" && value !== "off";
				} else state.object.smooth = true;
				const material = state.object.currentMaterial();
				if (material) material.smooth = state.object.smooth;
			} else {
				if (line === "\0") continue;
				console.warn("THREE.OBJLoader: Unexpected line: \"" + line + "\"");
			}
		}
		state.finalize();
		const container = new Group();
		container.materialLibraries = [].concat(state.materialLibraries);
		if (!(state.objects.length === 1 && state.objects[0].geometry.vertices.length === 0) === true) for (let i = 0, l = state.objects.length; i < l; i++) {
			const object = state.objects[i];
			const geometry = object.geometry;
			const materials = object.materials;
			const isLine = geometry.type === "Line";
			const isPoints = geometry.type === "Points";
			let hasVertexColors = false;
			if (geometry.vertices.length === 0) continue;
			const buffergeometry = new BufferGeometry();
			buffergeometry.setAttribute("position", new Float32BufferAttribute(geometry.vertices, 3));
			if (geometry.normals.length > 0) buffergeometry.setAttribute("normal", new Float32BufferAttribute(geometry.normals, 3));
			if (geometry.colors.length > 0) {
				hasVertexColors = true;
				buffergeometry.setAttribute("color", new Float32BufferAttribute(geometry.colors, 3));
			}
			if (geometry.hasUVIndices === true) buffergeometry.setAttribute("uv", new Float32BufferAttribute(geometry.uvs, 2));
			const createdMaterials = [];
			for (let mi = 0, miLen = materials.length; mi < miLen; mi++) {
				const sourceMaterial = materials[mi];
				const materialHash = sourceMaterial.name + "_" + sourceMaterial.smooth + "_" + hasVertexColors;
				let material = state.materials[materialHash];
				if (this.materials !== null) {
					material = this.materials.create(sourceMaterial.name);
					if (isLine && material && !(material instanceof LineBasicMaterial)) {
						const materialLine = new LineBasicMaterial();
						Material.prototype.copy.call(materialLine, material);
						materialLine.color.copy(material.color);
						material = materialLine;
					} else if (isPoints && material && !(material instanceof PointsMaterial)) {
						const materialPoints = new PointsMaterial({
							size: 10,
							sizeAttenuation: false
						});
						Material.prototype.copy.call(materialPoints, material);
						materialPoints.color.copy(material.color);
						materialPoints.map = material.map;
						material = materialPoints;
					}
				}
				if (material === void 0) {
					if (isLine) material = new LineBasicMaterial();
					else if (isPoints) material = new PointsMaterial({
						size: 1,
						sizeAttenuation: false
					});
					else material = new MeshPhongMaterial();
					material.name = sourceMaterial.name;
					material.flatShading = sourceMaterial.smooth ? false : true;
					material.vertexColors = hasVertexColors;
					state.materials[materialHash] = material;
				}
				createdMaterials.push(material);
			}
			let mesh;
			if (createdMaterials.length > 1) {
				for (let mi = 0, miLen = materials.length; mi < miLen; mi++) {
					const sourceMaterial = materials[mi];
					buffergeometry.addGroup(sourceMaterial.groupStart, sourceMaterial.groupCount, mi);
				}
				if (isLine) mesh = new LineSegments(buffergeometry, createdMaterials);
				else if (isPoints) mesh = new Points(buffergeometry, createdMaterials);
				else mesh = new Mesh(buffergeometry, createdMaterials);
			} else if (isLine) mesh = new LineSegments(buffergeometry, createdMaterials[0]);
			else if (isPoints) mesh = new Points(buffergeometry, createdMaterials[0]);
			else mesh = new Mesh(buffergeometry, createdMaterials[0]);
			mesh.name = object.name;
			container.add(mesh);
		}
		else if (state.vertices.length > 0) {
			const material = new PointsMaterial({
				size: 1,
				sizeAttenuation: false
			});
			const buffergeometry = new BufferGeometry();
			buffergeometry.setAttribute("position", new Float32BufferAttribute(state.vertices, 3));
			if (state.colors.length > 0 && state.colors[0] !== void 0) {
				buffergeometry.setAttribute("color", new Float32BufferAttribute(state.colors, 3));
				material.vertexColors = true;
			}
			const points = new Points(buffergeometry, material);
			container.add(points);
		}
		return container;
	}
};
//#endregion
export { OBJLoader };

//# sourceMappingURL=three_examples_jsm_loaders_OBJLoader__js.js.map