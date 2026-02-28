/**
 * Seed script for SkillQuestion question bank
 * Run: node scripts/seedQuestions.js
 */
const mongoose = require("mongoose");
require("dotenv").config();

const SkillQuestion = require("../models/SkillQuestion");

const questions = [
  // ──────────────── JAVASCRIPT ────────────────
  {
    skillName: "javascript",
    question: "What is the output of `typeof null` in JavaScript?",
    options: [
      { text: '"null"', isCorrect: false },
      { text: '"undefined"', isCorrect: false },
      { text: '"object"', isCorrect: true },
      { text: '"boolean"', isCorrect: false },
    ],
    difficulty: "intermediate",
    explanation: "typeof null returns 'object' due to a legacy bug in JavaScript.",
    category: "programming",
  },
  {
    skillName: "javascript",
    question: "Which method is used to convert a JSON string to a JavaScript object?",
    options: [
      { text: "JSON.stringify()", isCorrect: false },
      { text: "JSON.parse()", isCorrect: true },
      { text: "JSON.toObject()", isCorrect: false },
      { text: "JSON.convert()", isCorrect: false },
    ],
    difficulty: "beginner",
    explanation: "JSON.parse() parses a JSON string and returns the JavaScript value.",
    category: "programming",
  },
  {
    skillName: "javascript",
    question: "What does the `===` operator check in JavaScript?",
    options: [
      { text: "Value only", isCorrect: false },
      { text: "Type only", isCorrect: false },
      { text: "Value and type", isCorrect: true },
      { text: "Reference", isCorrect: false },
    ],
    difficulty: "beginner",
    explanation: "=== is the strict equality operator that checks both value and type.",
    category: "programming",
  },
  {
    skillName: "javascript",
    question: "What is a closure in JavaScript?",
    options: [
      { text: "A way to close a browser window", isCorrect: false },
      { text: "A function that has access to variables from its outer scope even after the outer function returns", isCorrect: true },
      { text: "A method to end a loop", isCorrect: false },
      { text: "A type of error handling", isCorrect: false },
    ],
    difficulty: "intermediate",
    explanation: "A closure is a function bundled with references to its surrounding state (lexical environment).",
    category: "programming",
  },
  {
    skillName: "javascript",
    question: "What is the purpose of `Promise.all()`?",
    options: [
      { text: "Executes promises sequentially", isCorrect: false },
      { text: "Waits for all promises to resolve or any to reject", isCorrect: true },
      { text: "Cancels all pending promises", isCorrect: false },
      { text: "Returns the first resolved promise", isCorrect: false },
    ],
    difficulty: "intermediate",
    explanation: "Promise.all() takes an iterable of promises and resolves when all have resolved, or rejects when any rejects.",
    category: "programming",
  },
  {
    skillName: "javascript",
    question: "What is the event loop in JavaScript?",
    options: [
      { text: "A loop that listens for DOM events", isCorrect: false },
      { text: "A mechanism that handles asynchronous callbacks by checking the call stack and task queue", isCorrect: true },
      { text: "A for loop that iterates over events", isCorrect: false },
      { text: "A built-in timer function", isCorrect: false },
    ],
    difficulty: "advanced",
    explanation: "The event loop continuously checks if the call stack is empty and pushes callbacks from the task queue.",
    category: "programming",
  },
  {
    skillName: "javascript",
    question: "What does `Array.prototype.reduce()` do?",
    options: [
      { text: "Removes elements from an array", isCorrect: false },
      { text: "Reduces the size of an array", isCorrect: false },
      { text: "Executes a reducer function on each element, resulting in a single output value", isCorrect: true },
      { text: "Filters out duplicate elements", isCorrect: false },
    ],
    difficulty: "intermediate",
    explanation: "reduce() executes a user-supplied reducer callback on each array element, passing in the return value from the previous calculation.",
    category: "programming",
  },
  {
    skillName: "javascript",
    question: "What is the difference between `let` and `var`?",
    options: [
      { text: "No difference", isCorrect: false },
      { text: "let is block-scoped, var is function-scoped", isCorrect: true },
      { text: "var is block-scoped, let is function-scoped", isCorrect: false },
      { text: "let cannot be reassigned", isCorrect: false },
    ],
    difficulty: "beginner",
    explanation: "let is block-scoped while var is function-scoped. let also doesn't hoist in the same way.",
    category: "programming",
  },
  {
    skillName: "javascript",
    question: "What is the output of `console.log(0.1 + 0.2 === 0.3)`?",
    options: [
      { text: "true", isCorrect: false },
      { text: "false", isCorrect: true },
      { text: "undefined", isCorrect: false },
      { text: "NaN", isCorrect: false },
    ],
    difficulty: "intermediate",
    explanation: "Due to floating-point precision, 0.1 + 0.2 equals 0.30000000000000004, not exactly 0.3.",
    category: "programming",
  },
  {
    skillName: "javascript",
    question: "What does the `spread operator (...)` do?",
    options: [
      { text: "Combines two strings", isCorrect: false },
      { text: "Expands an iterable into individual elements", isCorrect: true },
      { text: "Deletes properties from an object", isCorrect: false },
      { text: "Creates a new scope", isCorrect: false },
    ],
    difficulty: "beginner",
    explanation: "The spread operator allows an iterable to be expanded in places like function calls or array literals.",
    category: "programming",
  },

  // ──────────────── REACT ────────────────
  {
    skillName: "react",
    question: "What is the Virtual DOM in React?",
    options: [
      { text: "A copy of the browser DOM stored in the server", isCorrect: false },
      { text: "A lightweight JavaScript representation of the real DOM", isCorrect: true },
      { text: "A debugging tool for DOM manipulation", isCorrect: false },
      { text: "A CSS framework for React", isCorrect: false },
    ],
    difficulty: "beginner",
    explanation: "The Virtual DOM is a lightweight copy of the real DOM that React uses for efficient updates.",
    category: "programming",
  },
  {
    skillName: "react",
    question: "What hook is used for side effects in functional components?",
    options: [
      { text: "useState", isCorrect: false },
      { text: "useEffect", isCorrect: true },
      { text: "useContext", isCorrect: false },
      { text: "useReducer", isCorrect: false },
    ],
    difficulty: "beginner",
    explanation: "useEffect lets you perform side effects in function components, similar to lifecycle methods.",
    category: "programming",
  },
  {
    skillName: "react",
    question: "What is the purpose of `React.memo()`?",
    options: [
      { text: "To add memos/notes to components", isCorrect: false },
      { text: "To prevent unnecessary re-renders by memoizing the component output", isCorrect: true },
      { text: "To store data in memory", isCorrect: false },
      { text: "To create a new component", isCorrect: false },
    ],
    difficulty: "intermediate",
    explanation: "React.memo is a higher-order component that skips re-rendering if props haven't changed.",
    category: "programming",
  },
  {
    skillName: "react",
    question: "What is the correct way to update state based on previous state?",
    options: [
      { text: "setState(count + 1)", isCorrect: false },
      { text: "setState(prev => prev + 1)", isCorrect: true },
      { text: "state = state + 1", isCorrect: false },
      { text: "this.state.count++", isCorrect: false },
    ],
    difficulty: "intermediate",
    explanation: "Using a callback function ensures you're working with the most current state value.",
    category: "programming",
  },
  {
    skillName: "react",
    question: "What does `useCallback` do?",
    options: [
      { text: "Calls a function immediately", isCorrect: false },
      { text: "Returns a memoized version of a callback function", isCorrect: true },
      { text: "Creates a new callback every render", isCorrect: false },
      { text: "Handles errors in callbacks", isCorrect: false },
    ],
    difficulty: "advanced",
    explanation: "useCallback returns a memoized callback that only changes if one of the dependencies has changed.",
    category: "programming",
  },
  {
    skillName: "react",
    question: "What is JSX?",
    options: [
      { text: "A JavaScript library", isCorrect: false },
      { text: "A syntax extension that allows writing HTML-like code in JavaScript", isCorrect: true },
      { text: "A CSS preprocessor", isCorrect: false },
      { text: "A testing framework", isCorrect: false },
    ],
    difficulty: "beginner",
    explanation: "JSX is a syntax extension for JavaScript that lets you write HTML-like markup inside JavaScript.",
    category: "programming",
  },
  {
    skillName: "react",
    question: "What is the purpose of `key` prop in React lists?",
    options: [
      { text: "To style list items", isCorrect: false },
      { text: "To help React identify which items have changed, added, or removed", isCorrect: true },
      { text: "To encrypt list data", isCorrect: false },
      { text: "To sort list items", isCorrect: false },
    ],
    difficulty: "beginner",
    explanation: "Keys help React identify which items in a list have changed, enabling efficient re-rendering.",
    category: "programming",
  },
  {
    skillName: "react",
    question: "What is the difference between controlled and uncontrolled components?",
    options: [
      { text: "Controlled components don't have state", isCorrect: false },
      { text: "Controlled components have their form data driven by React state", isCorrect: true },
      { text: "Uncontrolled components cannot be used in React", isCorrect: false },
      { text: "There is no difference", isCorrect: false },
    ],
    difficulty: "intermediate",
    explanation: "In a controlled component, form data is handled by React state. In uncontrolled, data is handled by the DOM itself.",
    category: "programming",
  },
  {
    skillName: "react",
    question: "What is React Context used for?",
    options: [
      { text: "Styling components", isCorrect: false },
      { text: "Making API calls", isCorrect: false },
      { text: "Sharing data across the component tree without passing props at every level", isCorrect: true },
      { text: "Routing between pages", isCorrect: false },
    ],
    difficulty: "intermediate",
    explanation: "Context provides a way to pass data through the component tree without manual prop drilling.",
    category: "programming",
  },
  {
    skillName: "react",
    question: "What is the purpose of `useMemo`?",
    options: [
      { text: "To memorize user preferences", isCorrect: false },
      { text: "To memoize expensive computations and avoid recalculating on every render", isCorrect: true },
      { text: "To create memos between components", isCorrect: false },
      { text: "To cache API responses", isCorrect: false },
    ],
    difficulty: "advanced",
    explanation: "useMemo caches the result of a calculation between re-renders, only recomputing when dependencies change.",
    category: "programming",
  },

  // ──────────────── PYTHON ────────────────
  {
    skillName: "python",
    question: "What is the output of `print(type([]))`?",
    options: [
      { text: "<class 'array'>", isCorrect: false },
      { text: "<class 'list'>", isCorrect: true },
      { text: "<class 'tuple'>", isCorrect: false },
      { text: "<class 'dict'>", isCorrect: false },
    ],
    difficulty: "beginner",
    explanation: "[] creates a list in Python, so type([]) returns <class 'list'>.",
    category: "programming",
  },
  {
    skillName: "python",
    question: "What is a Python decorator?",
    options: [
      { text: "A way to add CSS to Python", isCorrect: false },
      { text: "A function that modifies the behavior of another function", isCorrect: true },
      { text: "A class constructor", isCorrect: false },
      { text: "A type of loop", isCorrect: false },
    ],
    difficulty: "intermediate",
    explanation: "A decorator is a function that takes another function and extends its behavior without modifying it.",
    category: "programming",
  },
  {
    skillName: "python",
    question: "What is the difference between a list and a tuple in Python?",
    options: [
      { text: "Lists are immutable, tuples are mutable", isCorrect: false },
      { text: "Lists are mutable, tuples are immutable", isCorrect: true },
      { text: "No difference", isCorrect: false },
      { text: "Tuples can only hold numbers", isCorrect: false },
    ],
    difficulty: "beginner",
    explanation: "Lists are mutable (can be changed), while tuples are immutable (cannot be changed after creation).",
    category: "programming",
  },
  {
    skillName: "python",
    question: "What does `*args` mean in a Python function definition?",
    options: [
      { text: "Multiplies all arguments", isCorrect: false },
      { text: "Allows the function to accept any number of positional arguments", isCorrect: true },
      { text: "Makes arguments optional", isCorrect: false },
      { text: "Creates a pointer to arguments", isCorrect: false },
    ],
    difficulty: "intermediate",
    explanation: "*args allows a function to accept a variable number of positional arguments as a tuple.",
    category: "programming",
  },
  {
    skillName: "python",
    question: "What is a Python generator?",
    options: [
      { text: "A function that generates random numbers", isCorrect: false },
      { text: "A function that uses yield to produce a sequence of values lazily", isCorrect: true },
      { text: "A class that creates objects", isCorrect: false },
      { text: "A module for code generation", isCorrect: false },
    ],
    difficulty: "advanced",
    explanation: "A generator is a function that uses yield to return values one at a time, enabling lazy evaluation.",
    category: "programming",
  },
  {
    skillName: "python",
    question: "What is the Global Interpreter Lock (GIL) in Python?",
    options: [
      { text: "A security feature", isCorrect: false },
      { text: "A mutex that protects access to Python objects, preventing multiple threads from executing Python bytecodes simultaneously", isCorrect: true },
      { text: "A global variable", isCorrect: false },
      { text: "A package manager lock file", isCorrect: false },
    ],
    difficulty: "advanced",
    explanation: "The GIL is a mutex in CPython that allows only one thread to execute Python bytecodes at a time.",
    category: "programming",
  },
  {
    skillName: "python",
    question: "What does `__init__` method do in a Python class?",
    options: [
      { text: "Destroys the object", isCorrect: false },
      { text: "Initializes a new instance of the class", isCorrect: true },
      { text: "Imports modules", isCorrect: false },
      { text: "Creates a static method", isCorrect: false },
    ],
    difficulty: "beginner",
    explanation: "__init__ is the constructor method called when creating a new instance of a class.",
    category: "programming",
  },
  {
    skillName: "python",
    question: "What is list comprehension in Python?",
    options: [
      { text: "A way to understand lists", isCorrect: false },
      { text: "A concise way to create lists using a single line of code", isCorrect: true },
      { text: "A method to compress lists", isCorrect: false },
      { text: "A sort algorithm", isCorrect: false },
    ],
    difficulty: "intermediate",
    explanation: "List comprehension provides a concise way to create lists: [expr for item in iterable if condition].",
    category: "programming",
  },
  {
    skillName: "python",
    question: "What is the purpose of `with` statement in Python?",
    options: [
      { text: "To import modules", isCorrect: false },
      { text: "To handle resource management and ensure cleanup (context managers)", isCorrect: true },
      { text: "To create loops", isCorrect: false },
      { text: "To define classes", isCorrect: false },
    ],
    difficulty: "intermediate",
    explanation: "The with statement simplifies resource management by ensuring proper cleanup, commonly used with file operations.",
    category: "programming",
  },
  {
    skillName: "python",
    question: "What is the difference between `deepcopy` and `copy` in Python?",
    options: [
      { text: "No difference", isCorrect: false },
      { text: "copy creates a shallow copy; deepcopy creates a fully independent copy of nested objects", isCorrect: true },
      { text: "deepcopy is faster", isCorrect: false },
      { text: "copy only works with strings", isCorrect: false },
    ],
    difficulty: "advanced",
    explanation: "copy() creates a shallow copy (nested objects share references), while deepcopy() recursively copies all nested objects.",
    category: "programming",
  },

  // ──────────────── NODE.JS ────────────────
  {
    skillName: "node.js",
    question: "What is Node.js built on?",
    options: [
      { text: "Python runtime", isCorrect: false },
      { text: "Chrome's V8 JavaScript engine", isCorrect: true },
      { text: "Java Virtual Machine", isCorrect: false },
      { text: ".NET framework", isCorrect: false },
    ],
    difficulty: "beginner",
    explanation: "Node.js is built on Chrome's V8 JavaScript engine for fast server-side JavaScript execution.",
    category: "programming",
  },
  {
    skillName: "node.js",
    question: "What is the purpose of `package.json`?",
    options: [
      { text: "To style the application", isCorrect: false },
      { text: "To manage project metadata, dependencies, and scripts", isCorrect: true },
      { text: "To define database schemas", isCorrect: false },
      { text: "To configure the web server", isCorrect: false },
    ],
    difficulty: "beginner",
    explanation: "package.json holds project metadata, dependency lists, scripts, and configuration for a Node.js project.",
    category: "programming",
  },
  {
    skillName: "node.js",
    question: "What is middleware in Express.js?",
    options: [
      { text: "A database layer", isCorrect: false },
      { text: "Functions that have access to request, response, and next in the request-response cycle", isCorrect: true },
      { text: "A frontend framework", isCorrect: false },
      { text: "A testing tool", isCorrect: false },
    ],
    difficulty: "intermediate",
    explanation: "Middleware functions can execute code, modify req/res, end the cycle, or call the next middleware.",
    category: "programming",
  },
  {
    skillName: "node.js",
    question: "What does `require()` do in Node.js?",
    options: [
      { text: "Installs a package", isCorrect: false },
      { text: "Imports/loads a module", isCorrect: true },
      { text: "Creates a new file", isCorrect: false },
      { text: "Starts the server", isCorrect: false },
    ],
    difficulty: "beginner",
    explanation: "require() is used to import modules, JSON, and local files in Node.js (CommonJS).",
    category: "programming",
  },
  {
    skillName: "node.js",
    question: "What is the difference between `process.nextTick()` and `setImmediate()`?",
    options: [
      { text: "No difference", isCorrect: false },
      { text: "nextTick fires before I/O callbacks; setImmediate fires after I/O callbacks", isCorrect: true },
      { text: "setImmediate is synchronous", isCorrect: false },
      { text: "nextTick is deprecated", isCorrect: false },
    ],
    difficulty: "advanced",
    explanation: "process.nextTick() fires at the end of the current operation, before any I/O. setImmediate() fires in the next iteration of the event loop.",
    category: "programming",
  },
  {
    skillName: "node.js",
    question: "What is the purpose of the `cluster` module in Node.js?",
    options: [
      { text: "To manage databases", isCorrect: false },
      { text: "To create child processes that share the same server port for load balancing", isCorrect: true },
      { text: "To cluster CSS styles", isCorrect: false },
      { text: "To group related modules", isCorrect: false },
    ],
    difficulty: "advanced",
    explanation: "The cluster module allows creating child processes that share server ports, utilizing multi-core systems.",
    category: "programming",
  },
  {
    skillName: "node.js",
    question: "What is a stream in Node.js?",
    options: [
      { text: "A video streaming service", isCorrect: false },
      { text: "An abstract interface for working with streaming data (read/write in chunks)", isCorrect: true },
      { text: "A type of variable", isCorrect: false },
      { text: "A logging mechanism", isCorrect: false },
    ],
    difficulty: "intermediate",
    explanation: "Streams are objects that let you read/write data continuously in chunks, useful for handling large data.",
    category: "programming",
  },
  {
    skillName: "node.js",
    question: "What is the `Buffer` class in Node.js?",
    options: [
      { text: "A UI component", isCorrect: false },
      { text: "A class for handling binary data directly", isCorrect: true },
      { text: "A caching mechanism", isCorrect: false },
      { text: "A type of array", isCorrect: false },
    ],
    difficulty: "intermediate",
    explanation: "Buffer provides a way to handle binary data in Node.js, allocated outside the V8 heap.",
    category: "programming",
  },
  {
    skillName: "node.js",
    question: "What module is used for file system operations in Node.js?",
    options: [
      { text: "http", isCorrect: false },
      { text: "fs", isCorrect: true },
      { text: "path", isCorrect: false },
      { text: "os", isCorrect: false },
    ],
    difficulty: "beginner",
    explanation: "The 'fs' module provides an API for interacting with the file system.",
    category: "programming",
  },
  {
    skillName: "node.js",
    question: "What is an EventEmitter in Node.js?",
    options: [
      { text: "A DOM event handler", isCorrect: false },
      { text: "A class that facilitates communication between objects via events (pub/sub pattern)", isCorrect: true },
      { text: "A CSS animation trigger", isCorrect: false },
      { text: "A timer function", isCorrect: false },
    ],
    difficulty: "intermediate",
    explanation: "EventEmitter is a class that implements the observer pattern, allowing objects to emit and listen for events.",
    category: "programming",
  },

  // ──────────────── TYPESCRIPT ────────────────
  {
    skillName: "typescript",
    question: "What is TypeScript?",
    options: [
      { text: "A completely new programming language", isCorrect: false },
      { text: "A typed superset of JavaScript that compiles to plain JavaScript", isCorrect: true },
      { text: "A JavaScript testing framework", isCorrect: false },
      { text: "A CSS preprocessor", isCorrect: false },
    ],
    difficulty: "beginner",
    explanation: "TypeScript extends JavaScript by adding static types that are removed during compilation.",
    category: "programming",
  },
  {
    skillName: "typescript",
    question: "What is the difference between `interface` and `type` in TypeScript?",
    options: [
      { text: "No difference at all", isCorrect: false },
      { text: "Interfaces can be extended and merged; types can use unions and intersections", isCorrect: true },
      { text: "Types are faster than interfaces", isCorrect: false },
      { text: "Interfaces can only define methods", isCorrect: false },
    ],
    difficulty: "intermediate",
    explanation: "Interfaces support declaration merging and extension; type aliases support unions, intersections, and mapped types.",
    category: "programming",
  },
  {
    skillName: "typescript",
    question: "What does the `?` mean after a property name in TypeScript?",
    options: [
      { text: "The property is required", isCorrect: false },
      { text: "The property is optional", isCorrect: true },
      { text: "The property is nullable", isCorrect: false },
      { text: "The property is read-only", isCorrect: false },
    ],
    difficulty: "beginner",
    explanation: "The ? after a property name marks it as optional, meaning it may or may not be present.",
    category: "programming",
  },
  {
    skillName: "typescript",
    question: "What are generics in TypeScript?",
    options: [
      { text: "Generic error handlers", isCorrect: false },
      { text: "A way to create reusable components that work with multiple types", isCorrect: true },
      { text: "Default types for all variables", isCorrect: false },
      { text: "A way to generate code automatically", isCorrect: false },
    ],
    difficulty: "intermediate",
    explanation: "Generics allow creating components that can work over a variety of types rather than a single one.",
    category: "programming",
  },
  {
    skillName: "typescript",
    question: "What is a union type in TypeScript?",
    options: [
      { text: "A type that combines two objects", isCorrect: false },
      { text: "A type that can be one of several types (A | B)", isCorrect: true },
      { text: "A type for arrays only", isCorrect: false },
      { text: "A type for database queries", isCorrect: false },
    ],
    difficulty: "beginner",
    explanation: "A union type describes a value that can be one of several types: string | number.",
    category: "programming",
  },
  {
    skillName: "typescript",
    question: "What is the `never` type used for?",
    options: [
      { text: "For nullable values", isCorrect: false },
      { text: "For values that never occur (functions that throw or infinite loops)", isCorrect: true },
      { text: "For boolean values", isCorrect: false },
      { text: "For undefined values", isCorrect: false },
    ],
    difficulty: "advanced",
    explanation: "The never type represents values that never occur, like a function that always throws an error.",
    category: "programming",
  },
  {
    skillName: "typescript",
    question: "What is `enum` in TypeScript?",
    options: [
      { text: "An error handler", isCorrect: false },
      { text: "A way to define a set of named constants", isCorrect: true },
      { text: "A loop construct", isCorrect: false },
      { text: "A module system", isCorrect: false },
    ],
    difficulty: "beginner",
    explanation: "Enums allow defining a set of named constants, making code more readable and maintainable.",
    category: "programming",
  },
  {
    skillName: "typescript",
    question: "What is a mapped type in TypeScript?",
    options: [
      { text: "A type for Map data structures", isCorrect: false },
      { text: "A type that creates a new type by transforming properties of an existing type", isCorrect: true },
      { text: "A type for geographic coordinates", isCorrect: false },
      { text: "A type alias for objects", isCorrect: false },
    ],
    difficulty: "advanced",
    explanation: "Mapped types transform each property in an existing type, e.g., Partial<T>, Readonly<T>.",
    category: "programming",
  },
  {
    skillName: "typescript",
    question: "What does `as const` do in TypeScript?",
    options: [
      { text: "Makes a variable mutable", isCorrect: false },
      { text: "Narrows the type to the literal value, making all properties readonly", isCorrect: true },
      { text: "Converts to a constant type", isCorrect: false },
      { text: "Creates a constant module", isCorrect: false },
    ],
    difficulty: "advanced",
    explanation: "`as const` creates a readonly literal type, inferring the narrowest possible type.",
    category: "programming",
  },
  {
    skillName: "typescript",
    question: "What is type narrowing in TypeScript?",
    options: [
      { text: "Reducing the size of types in memory", isCorrect: false },
      { text: "Refining a broader type to a more specific one using type guards", isCorrect: true },
      { text: "Converting types to strings", isCorrect: false },
      { text: "Removing properties from types", isCorrect: false },
    ],
    difficulty: "intermediate",
    explanation: "Type narrowing refines a union type to a more specific type using typeof, instanceof, or custom type guards.",
    category: "programming",
  },

  // ──────────────── CSS ────────────────
  {
    skillName: "css",
    question: "What does CSS stand for?",
    options: [
      { text: "Computer Style Sheets", isCorrect: false },
      { text: "Cascading Style Sheets", isCorrect: true },
      { text: "Creative Style System", isCorrect: false },
      { text: "Colorful Style Sheets", isCorrect: false },
    ],
    difficulty: "beginner",
    explanation: "CSS stands for Cascading Style Sheets.",
    category: "design",
  },
  {
    skillName: "css",
    question: "What is the CSS Box Model?",
    options: [
      { text: "A layout for boxes", isCorrect: false },
      { text: "A model that describes content, padding, border, and margin around every element", isCorrect: true },
      { text: "A 3D rendering model", isCorrect: false },
      { text: "A grid system", isCorrect: false },
    ],
    difficulty: "beginner",
    explanation: "The box model describes how every element has content, padding, border, and margin.",
    category: "design",
  },
  {
    skillName: "css",
    question: "What is the difference between `flexbox` and `grid`?",
    options: [
      { text: "No difference", isCorrect: false },
      { text: "Flexbox is one-dimensional (row or column); Grid is two-dimensional (rows and columns)", isCorrect: true },
      { text: "Grid is older than flexbox", isCorrect: false },
      { text: "Flexbox doesn't support alignment", isCorrect: false },
    ],
    difficulty: "intermediate",
    explanation: "Flexbox handles layout in one dimension, while Grid handles two-dimensional layouts.",
    category: "design",
  },
  {
    skillName: "css",
    question: "What does `z-index` control?",
    options: [
      { text: "The zoom level of an element", isCorrect: false },
      { text: "The stacking order of positioned elements", isCorrect: true },
      { text: "The width of an element", isCorrect: false },
      { text: "The animation speed", isCorrect: false },
    ],
    difficulty: "intermediate",
    explanation: "z-index controls the vertical stacking order of elements that overlap.",
    category: "design",
  },
  {
    skillName: "css",
    question: "What is the specificity order in CSS (highest to lowest)?",
    options: [
      { text: "class > id > inline > element", isCorrect: false },
      { text: "inline > id > class > element", isCorrect: true },
      { text: "element > class > id > inline", isCorrect: false },
      { text: "id > inline > element > class", isCorrect: false },
    ],
    difficulty: "intermediate",
    explanation: "Specificity hierarchy: inline styles > ID selectors > class selectors > element selectors.",
    category: "design",
  },
  {
    skillName: "css",
    question: "What are CSS custom properties (variables)?",
    options: [
      { text: "JavaScript variables used in CSS", isCorrect: false },
      { text: "Entities defined by CSS authors that contain specific values reusable throughout a document", isCorrect: true },
      { text: "Built-in browser styles", isCorrect: false },
      { text: "SCSS-only features", isCorrect: false },
    ],
    difficulty: "intermediate",
    explanation: "CSS custom properties (--var-name) allow defining reusable values, accessed with var(--var-name).",
    category: "design",
  },
  {
    skillName: "css",
    question: "What is `position: sticky` in CSS?",
    options: [
      { text: "An element that scrolls with the page", isCorrect: false },
      { text: "An element that toggles between relative and fixed positioning based on scroll position", isCorrect: true },
      { text: "An element that cannot be moved", isCorrect: false },
      { text: "An absolute positioned element", isCorrect: false },
    ],
    difficulty: "intermediate",
    explanation: "sticky positioning toggles between relative and fixed based on the user's scroll position.",
    category: "design",
  },
  {
    skillName: "css",
    question: "What does `display: none` do compared to `visibility: hidden`?",
    options: [
      { text: "Both are identical", isCorrect: false },
      { text: "display:none removes from flow and hides; visibility:hidden hides but keeps the space", isCorrect: true },
      { text: "visibility:hidden removes from the DOM", isCorrect: false },
      { text: "display:none only hides text", isCorrect: false },
    ],
    difficulty: "beginner",
    explanation: "display:none removes the element from the document flow, while visibility:hidden just makes it invisible.",
    category: "design",
  },
  {
    skillName: "css",
    question: "What are CSS media queries used for?",
    options: [
      { text: "Playing media files", isCorrect: false },
      { text: "Applying styles conditionally based on device characteristics like screen size", isCorrect: true },
      { text: "Querying a database", isCorrect: false },
      { text: "Importing media files", isCorrect: false },
    ],
    difficulty: "beginner",
    explanation: "Media queries apply CSS rules conditionally based on device characteristics like viewport width.",
    category: "design",
  },
  {
    skillName: "css",
    question: "What is the `clamp()` function in CSS?",
    options: [
      { text: "A function to clamp elements to the viewport", isCorrect: false },
      { text: "A function that sets a value between a minimum and maximum: clamp(min, preferred, max)", isCorrect: true },
      { text: "A function to compress CSS", isCorrect: false },
      { text: "A function to group selectors", isCorrect: false },
    ],
    difficulty: "advanced",
    explanation: "clamp(min, preferred, max) constrains a value between an upper and lower bound.",
    category: "design",
  },

  // ──────────────── MONGODB ────────────────
  {
    skillName: "mongodb",
    question: "What type of database is MongoDB?",
    options: [
      { text: "Relational database", isCorrect: false },
      { text: "Document-oriented NoSQL database", isCorrect: true },
      { text: "Graph database", isCorrect: false },
      { text: "Key-value store", isCorrect: false },
    ],
    difficulty: "beginner",
    explanation: "MongoDB is a document-oriented NoSQL database that stores data in JSON-like documents.",
    category: "programming",
  },
  {
    skillName: "mongodb",
    question: "What is the purpose of indexing in MongoDB?",
    options: [
      { text: "To compress data", isCorrect: false },
      { text: "To improve query performance by creating efficient data structures", isCorrect: true },
      { text: "To encrypt data", isCorrect: false },
      { text: "To backup data", isCorrect: false },
    ],
    difficulty: "intermediate",
    explanation: "Indexes support efficient query execution by limiting the number of documents MongoDB needs to scan.",
    category: "programming",
  },
  {
    skillName: "mongodb",
    question: "What is the aggregation pipeline in MongoDB?",
    options: [
      { text: "A way to combine collections", isCorrect: false },
      { text: "A framework for data processing that passes documents through multi-stage transformations", isCorrect: true },
      { text: "A backup mechanism", isCorrect: false },
      { text: "A replication tool", isCorrect: false },
    ],
    difficulty: "advanced",
    explanation: "The aggregation pipeline processes documents through stages like $match, $group, $sort, and $project.",
    category: "programming",
  },
  {
    skillName: "mongodb",
    question: "What does `populate()` do in Mongoose?",
    options: [
      { text: "Fills the database with test data", isCorrect: false },
      { text: "Automatically replaces specified paths with documents from other collections", isCorrect: true },
      { text: "Populates form fields", isCorrect: false },
      { text: "Creates new collections", isCorrect: false },
    ],
    difficulty: "intermediate",
    explanation: "populate() in Mongoose automatically replaces ObjectId references with the actual referenced documents.",
    category: "programming",
  },
  {
    skillName: "mongodb",
    question: "What are MongoDB transactions used for?",
    options: [
      { text: "Financial transactions only", isCorrect: false },
      { text: "Ensuring multiple operations either all succeed or all fail (atomicity)", isCorrect: true },
      { text: "Logging database changes", isCorrect: false },
      { text: "Transferring data between collections", isCorrect: false },
    ],
    difficulty: "advanced",
    explanation: "MongoDB transactions ensure ACID properties for multi-document operations.",
    category: "programming",
  },
  {
    skillName: "mongodb",
    question: "What is sharding in MongoDB?",
    options: [
      { text: "Splitting a document into parts", isCorrect: false },
      { text: "Distributing data across multiple machines for horizontal scaling", isCorrect: true },
      { text: "Creating database backups", isCorrect: false },
      { text: "Encrypting data at rest", isCorrect: false },
    ],
    difficulty: "advanced",
    explanation: "Sharding distributes data across multiple servers to handle large data sets and high throughput.",
    category: "programming",
  },
  {
    skillName: "mongodb",
    question: "What is the difference between `find()` and `findOne()` in MongoDB?",
    options: [
      { text: "No difference", isCorrect: false },
      { text: "find() returns a cursor of all matching documents; findOne() returns the first match", isCorrect: true },
      { text: "findOne() is faster", isCorrect: false },
      { text: "find() only works with indexes", isCorrect: false },
    ],
    difficulty: "beginner",
    explanation: "find() returns a cursor to all matching documents, while findOne() returns only the first matching document.",
    category: "programming",
  },
  {
    skillName: "mongodb",
    question: "What does the `$lookup` stage do in aggregation?",
    options: [
      { text: "Searches for text in documents", isCorrect: false },
      { text: "Performs a left outer join to another collection", isCorrect: true },
      { text: "Looks up environment variables", isCorrect: false },
      { text: "Finds duplicate documents", isCorrect: false },
    ],
    difficulty: "advanced",
    explanation: "$lookup performs a left outer join to another collection in the same database.",
    category: "programming",
  },
  {
    skillName: "mongodb",
    question: "What is a MongoDB replica set?",
    options: [
      { text: "A copy of the database code", isCorrect: false },
      { text: "A group of MongoDB instances that maintain the same data set for redundancy", isCorrect: true },
      { text: "A set of duplicate documents", isCorrect: false },
      { text: "A testing environment", isCorrect: false },
    ],
    difficulty: "intermediate",
    explanation: "A replica set is a group of MongoDB servers that maintain the same data, providing failover and redundancy.",
    category: "programming",
  },
  {
    skillName: "mongodb",
    question: "What is an embedded document in MongoDB?",
    options: [
      { text: "A document stored in a separate file", isCorrect: false },
      { text: "A document nested inside another document", isCorrect: true },
      { text: "A hidden document", isCorrect: false },
      { text: "A document with a password", isCorrect: false },
    ],
    difficulty: "beginner",
    explanation: "An embedded document is a document contained within another document, allowing denormalized data models.",
    category: "programming",
  },
];

async function seed() {
  try {
    const mongoURI = process.env.MongoDBURL || process.env.MONGO_URI || process.env.MONGODB_URI || "mongodb://localhost:27017/devops";
    await mongoose.connect(mongoURI);
    console.log("Connected to MongoDB");

    // Clear existing questions
    await SkillQuestion.deleteMany({});
    console.log("Cleared existing questions");

    // Insert seed data
    const result = await SkillQuestion.insertMany(questions);
    console.log(`Seeded ${result.length} questions across ${[...new Set(questions.map(q => q.skillName))].length} skills`);

    // Log summary
    const summary = {};
    for (const q of questions) {
      summary[q.skillName] = (summary[q.skillName] || 0) + 1;
    }
    console.table(summary);

    await mongoose.disconnect();
    console.log("Done!");
    process.exit(0);
  } catch (err) {
    console.error("Seed error:", err);
    process.exit(1);
  }
}

seed();
