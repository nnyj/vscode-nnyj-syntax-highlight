const indentedTable = require('./indented_table');

function activate(context) {
  indentedTable.register(context);
}

function deactivate() {
  indentedTable.dispose();
}

module.exports = { activate, deactivate };
