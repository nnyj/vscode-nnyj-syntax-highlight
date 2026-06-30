const indentedTable = require('./indented_table');
const shellComment = require('./shell_comment');

function activate(context) {
  indentedTable.register(context);
  shellComment.register(context);
}

function deactivate() {
  indentedTable.dispose();
  shellComment.dispose();
}

module.exports = { activate, deactivate };
