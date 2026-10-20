// ruleid: react-component-options-param
function BadPanel(props, options = {}) { return <section>{props.title}</section>; }

// ruleid: react-component-options-param
const BadArrow = (props, options = {}) => <span />;

// ruleid: react-component-options-param
const BadBlock = (props, options) => { return <Widget />; };

// ruleid: react-component-options-param
const BadExpression = function(props, options) { return <><span /></>; };

// ok: react-component-options-param
function GoodPanel({ title, options }) { return <section>{title}</section>; }

// ok: react-component-options-param
function buildPanel(props, options = {}) { return <section />; }

// ok: react-component-options-param
function PascalUtility(input, options = {}) { return { input, options }; }

// A ref callback has its own React ABI, not a component options parameter.
// ok: react-component-options-param
const RefPanel = forwardRef((props, ref) => <input ref={ref} />);
