const getType = (v) => {
    return Object.prototype.toString.call(v).slice(8, -1); // e.g. "Object", "String", "Array", "Error"
}

module.exports = {getType}