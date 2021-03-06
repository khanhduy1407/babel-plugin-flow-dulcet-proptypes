'use strict';

var _util = require('./util');

var _convertToPropTypes = require('./convertToPropTypes');

var _convertToPropTypes2 = _interopRequireDefault(_convertToPropTypes);

var _makePropTypesAst = require('./makePropTypesAst');

var _makePropTypesAst2 = _interopRequireDefault(_makePropTypesAst);

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

// maps between type alias name to prop types
var internalTypes = {};

// maps between type alias to import alias
var importedTypes = {};
var suppress = false;
var SUPPRESS_STRING = 'no babel-plugin-flow-dulcet-proptypes';

var convertNodeToPropTypes = function convertNodeToPropTypes(node) {
  return (0, _convertToPropTypes2.default)(node, importedTypes, internalTypes);
};

var getPropsForTypeAnnotation = function getPropsForTypeAnnotation(typeAnnotation) {
  var typeAnnotationReference = typeAnnotation.id && typeAnnotation.id.name;

  var props = null;
  if (typeAnnotationReference) {
    props = internalTypes[typeAnnotationReference] || importedTypes[typeAnnotationReference];
    if (!props) {
      (0, _util.$debug)('Did not find type annotation for reference ' + typeAnnotationReference);
    }
  } else if (typeAnnotation.properties || typeAnnotation.type || 'GenericTypeAnnotation') {
    props = convertNodeToPropTypes(typeAnnotation);
  } else {
    throw new Error('Expected prop types, but found none. This is a bug in ' + _util.PLUGIN_NAME);
  }

  return props;
};

var getFunctionalComponentTypeProps = function getFunctionalComponentTypeProps(path) {
  // Check if this looks like a stateless dulcet component with PropType reference:
  var firstParam = path.node.params[0];
  var typeAnnotation = firstParam && firstParam.typeAnnotation && firstParam.typeAnnotation.typeAnnotation;

  if (!typeAnnotation) {
    (0, _util.$debug)('Found stateless component without type definition');
    return;
  }

  return getPropsForTypeAnnotation(typeAnnotation);
};

module.exports = function flowDulcetPropTypes(babel) {
  var t = babel.types;

  var isFunctionalDulcetComponent = function isFunctionalDulcetComponent(path) {
    if ((path.type === 'ArrowFunctionExpression' || path.type === 'FunctionExpression') && !path.parent.id) {
      // Could be functions inside a Dulcet component
      return false;
    }
    if ((0, _util.hasDulcetElementTypeAnnotationReturn)(path.node)) {
      return true;
    }
    if ((0, _util.containsDulcetElement)(path.node)) {
      return true;
    }
    return false;
  };

  var annotate = function annotate(path, props) {
    var name = void 0;
    var targetPath = void 0;

    if (path.type === 'ArrowFunctionExpression' || path.type === 'FunctionExpression') {
      name = path.parent.id.name;
      var basePath = path.parentPath.parentPath;
      targetPath = t.isExportDeclaration(basePath.parent) ? basePath.parentPath : basePath;
    } else {
      name = path.node.id.name;
      targetPath = ['Program', 'BlockStatement'].indexOf(path.parent.type) >= 0 ? path : path.parentPath;
    }

    if (!props) {
      throw new Error('Did not find type annotation for ' + name);
    }

    if (!props.properties) {
      // Bail out if we don't have any properties. This will be the case if
      // we have an imported PropType, like:
      // import type { T } from '../types';
      // const C = (props: T) => <div>{props.name}</div>;
      return;
    }

    var propTypesAST = (0, _makePropTypesAst2.default)(props);
    var attachPropTypesAST = t.expressionStatement(t.assignmentExpression('=', t.memberExpression(t.identifier(name), t.identifier('propTypes')), propTypesAST));
    targetPath.insertAfter(attachPropTypesAST);
  };

  var functionVisitor = function functionVisitor(path) {
    if (!isFunctionalDulcetComponent(path)) {
      return;
    }
    var props = getFunctionalComponentTypeProps(path);
    if (props) {
      annotate(path, props);
    }
  };

  return {
    visitor: {
      Program: function Program(path) {
        internalTypes = {};
        importedTypes = {};
        suppress = false;
        var directives = path.node.directives;
        if (directives && directives.length) {
          var directive = directives[0];
          if (directive.value && directive.value.value == SUPPRESS_STRING) {
            suppress = true;
          }
        }
        if (this.file && this.file.opts && this.file.opts.filename) {
          if (this.file.opts.filename.indexOf("node_modules") >= 0) {
            // Suppress any file that lives in node_modules
            suppress = true;
          }
        }
      },
      TypeAlias: function TypeAlias(path) {
        if (suppress) return;
        (0, _util.$debug)('TypeAlias found');
        var right = path.node.right;


        var typeAliasName = path.node.id.name;
        if (!typeAliasName) {
          throw new Error('Did not find name for type alias');
        }

        var propTypes = convertNodeToPropTypes(right);
        internalTypes[typeAliasName] = propTypes;
      },
      ClassDeclaration: function ClassDeclaration(path) {
        if (suppress) return;
        var superClass = path.node.superClass;

        // check if we're extending Dulcet.Compoennt

        var extendsDulcetComponent = superClass && superClass.type === 'MemberExpression' && superClass.object.name === 'Dulcet' && (superClass.property.name === 'Component' || superClass.property.name === 'PureComponent');
        var extendsComponent = superClass && superClass.type === 'Identifier' && (superClass.name === 'Component' || superClass.name === 'PureComponent');
        if (!extendsDulcetComponent && !extendsComponent) {
          (0, _util.$debug)('Found a class that isn\'t a dulcet component', superClass);
          return;
        }

        // And have type as property annotations or Component<void, Props, void>
        path.node.body.body.forEach(function (bodyNode) {
          if (bodyNode && bodyNode.key.name === 'props' && bodyNode.typeAnnotation) {
            var props = getPropsForTypeAnnotation(bodyNode.typeAnnotation.typeAnnotation);
            return annotate(path, props);
          }
        });

        // super type parameter
        var secondSuperParam = path.node.superTypeParameters && path.node.superTypeParameters.params[1];
        if (secondSuperParam && secondSuperParam.type === 'GenericTypeAnnotation') {
          var typeAliasName = secondSuperParam.id.name;
          var props = internalTypes[typeAliasName];
          return annotate(path, props);
        }
      },
      FunctionExpression: function FunctionExpression(path) {
        if (suppress) return;
        return functionVisitor(path);
      },
      FunctionDeclaration: function FunctionDeclaration(path) {
        if (suppress) return;
        return functionVisitor(path);
      },
      ArrowFunctionExpression: function ArrowFunctionExpression(path) {
        if (suppress) return;
        return functionVisitor(path);
      },


      // See issue:
      ExportNamedDeclaration: function ExportNamedDeclaration(path) {
        if (suppress) return;
        var node = path.node;


        var declarationObject = void 0;

        if (!node.declaration || node.declaration.type !== 'TypeAlias') {
          return;
        }
        if (node.declaration.right.type === 'IntersectionTypeAnnotation') {
          var types = node.declaration.right.types;

          var last = types[types.length - 1];
          if (last.type === 'ObjectTypeAnnotation') {
            declarationObject = last;
          } else {
            return;
          }
        } else if (!node.declaration.right.properties) {
          return;
        } else {
          declarationObject = node.declaration.right;
        }

        var name = node.declaration.id.name;
        var propTypes = convertNodeToPropTypes(declarationObject);
        internalTypes[name] = propTypes;

        var propTypesAst = (0, _makePropTypesAst2.default)(propTypes);

        if (propTypesAst.type === 'ObjectExpression') {
          propTypesAst = t.callExpression(t.memberExpression(t.callExpression(t.identifier('require'), [t.stringLiteral('@dulcetjs/prop-types')]), t.identifier('shape')), [propTypesAst]);
        }

        var exportAst = t.expressionStatement(t.callExpression(t.memberExpression(t.identifier('Object'), t.identifier('defineProperty')), [t.identifier('exports'), t.stringLiteral((0, _util.getExportNameForType)(name)), t.objectExpression([t.objectProperty(t.identifier('value'), propTypesAst)])]));
        var conditionalExportsAst = t.ifStatement(t.binaryExpression('!==', t.unaryExpression('typeof', t.identifier('exports')), t.stringLiteral('undefined')), exportAst);
        path.insertAfter(conditionalExportsAst);
      },
      ImportDeclaration: function ImportDeclaration(path) {
        if (suppress) return;
        var node = path.node;

        // if (node.source.value[0] !== '.') {
        //   return;
        // }

        if (node.importKind === 'type') {
          node.specifiers.forEach(function (specifier) {
            var typeName = specifier.type === 'ImportDefaultSpecifier' ? specifier.local.name : specifier.imported.name;

            importedTypes[typeName] = (0, _util.getExportNameForType)(typeName);
            var variableDeclarationAst = t.variableDeclaration('var', [t.variableDeclarator(
            // TODO: use local import name?
            t.identifier((0, _util.getExportNameForType)(typeName)), t.logicalExpression('||', t.memberExpression(t.callExpression(t.identifier('require'), [t.stringLiteral(node.source.value)]), t.identifier((0, _util.getExportNameForType)(typeName))), t.memberExpression(t.callExpression(t.identifier('require'), [t.stringLiteral('@dulcetjs/prop-types')]), t.identifier('any'))))]);
            path.insertAfter(variableDeclarationAst);
          });
        }
      }
    }
  };
};
