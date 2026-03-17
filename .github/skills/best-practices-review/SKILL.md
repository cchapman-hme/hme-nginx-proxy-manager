---
name: best-practices-review
title: "Code Review & Best Practices Analysis"
description: "You MUST use this when called upon to review the codebase for best practices adherence. Evaluates structure, style, naming, error handling, documentation, testing, security, performance, and detects AI-generated code patterns."
---

# Code Review & Best Practices Analysis

## Overview

This skill guides AI agents in performing comprehensive code reviews that evaluate whether a codebase follows industry best practices, language-specific conventions, and the subtle "unwritten rules" that distinguish professional, human-written code from AI-generated code.

## When to Use This Skill

Trigger this skill when users request:
- "Review my code for best practices"

## Review Categories

### 1. Project Structure & Organization

**General Best Practices:**
- **Directory Structure**: Follows language/framework conventions (e.g., `src/`, `tests/`, `docs/`, `config/`)
- **Separation of Concerns**: Clear boundaries between business logic, data access, UI, utilities
- **File Naming**: Consistent naming conventions (kebab-case, snake_case, PascalCase as appropriate)
- **Module Organization**: Logical grouping of related functionality
- **Configuration Management**: Separate configs for dev/staging/prod, not hardcoded

**Red Flags:**
- Everything in one file or one directory
- Mix of naming conventions (myFile.js, another-file.js, YetAnotherFile.js)
- Business logic mixed with presentation code
- Config files with hardcoded credentials or secrets
- Test files mixed with source code

### 2. Code Style & Formatting

**General Best Practices:**
- **Consistent Indentation**: 2 or 4 spaces (not mixed tabs/spaces)
- **Line Length**: Reasonable limits (80-120 characters typically)
- **Whitespace**: Consistent use around operators, after commas
- **Brace Style**: Consistent (K&R, Allman, etc.)
- **Import Organization**: Grouped logically (standard library, third-party, local)

**Language-Specific Examples:**

*Python:*
- Follows PEP 8
- 4-space indentation
- snake_case for functions/variables, PascalCase for classes
- Imports sorted (stdlib → third-party → local)
- Docstrings for public functions/classes

*JavaScript/TypeScript:*
- Semicolons used consistently (or consistently omitted)
- 2-space indentation common
- camelCase for variables/functions, PascalCase for classes
- Modern ES6+ syntax (const/let, arrow functions, destructuring)
- Proper use of async/await vs promises

*Go:*
- gofmt applied (proper formatting)
- Short variable names in small scopes
- Error handling on every error return
- Interfaces defined in consumer packages
- Capitalization for exported vs unexported

**Red Flags:**
- Mixed indentation (tabs and spaces)
- Inconsistent brace placement
- Random blank lines or lack of whitespace
- Extremely long lines (>150 characters)
- No formatting standards applied

### 3. Naming Conventions

**Best Practices:**
- **Variables**: Descriptive names, avoid single letters except in small scopes
- **Functions**: Verb-based names that describe action (getUserById, calculateTotal)
- **Classes**: Noun-based names (UserService, PaymentProcessor)
- **Constants**: SCREAMING_SNAKE_CASE or language-appropriate convention
- **Booleans**: Prefixed with is/has/can/should (isValid, hasPermission)
- **Private Members**: Language-appropriate markers (_ prefix, # in JS, lowercase in Go)

**Convention Examples:**

*Python:*
```python
# Good
def calculate_total_price(items):
    """Calculate the total price of items."""
    pass

# Bad
def calc(x):  # Too abbreviated
    pass

def CalculateTotalPrice(items):  # Wrong case for Python
    pass
```

*JavaScript:*
```javascript
// Good
const MAX_RETRY_ATTEMPTS = 3;
const isValidEmail = (email) => /^.+@.+\..+$/.test(email);

// Bad
const maxRetryAttempts = 3;  // Should be uppercase for constants
const ValidateEmail = (email) => ...;  // Should be camelCase
```

**Red Flags:**
- Generic names (data, temp, var1, myFunction)
- Inconsistent casing within same codebase
- Abbreviated names that aren't common (usr, calc, proc)
- Classes or functions with vague names (Manager, Handler, Utils)

### 4. Error Handling & Validation

**Best Practices:**
- **Input Validation**: Check user input, API data, file contents
- **Error Messages**: Descriptive, actionable messages (not just "Error")
- **Proper Exceptions**: Use built-in exception types or create custom ones
- **Graceful Degradation**: Handle failures without crashing
- **Logging**: Appropriate log levels (debug, info, warning, error)
- **Resource Cleanup**: Use context managers, try/finally, defer, RAII

**Language-Specific:**

*Python:*
```python
# Good
try:
    result = risky_operation()
except SpecificException as e:
    logger.error(f"Operation failed: {e}", exc_info=True)
    raise
finally:
    cleanup_resources()

# Bad
try:
    result = risky_operation()
except:  # Bare except catches everything
    pass  # Silent failure
```

*Go:*
```go
// Good
if err != nil {
    return fmt.Errorf("failed to process user %s: %w", userID, err)
}

// Bad
if err != nil {
    return err  // No context
}
// or worse - ignoring errors entirely
doSomething()  // No error check
```

**Red Flags:**
- Bare except/catch blocks that swallow all errors
- No input validation
- Error messages like "Error", "Failed", "Something went wrong"
- Ignored error returns
- No logging or debugging information

### 5. Comments & Documentation

**Best Practices:**
- **Self-Documenting Code**: Clear names reduce need for comments
- **Why Not What**: Comments explain reasoning, not obvious code
- **Public APIs**: All public functions/classes documented
- **Complex Logic**: Brief explanation of non-obvious algorithms
- **TODOs**: Include ticket numbers or context
- **No Dead Code**: Remove commented-out code (use version control)

**Good vs Bad:**

```python
# Bad - stating the obvious
# Increment counter by 1
counter += 1

# Get the user
user = get_user(id)

# Good - explaining why
# Use exponential backoff to avoid overwhelming the API
# after receiving 429 rate limit errors
time.sleep(2 ** retry_count)

# Temporarily disable validation until TICKET-123 is resolved
# validation_enabled = False
```

**Red Flags:**
- Comments that just restate the code
- Large blocks of commented-out code
- Outdated comments that don't match code
- No documentation for public APIs
- TODO comments with no context or owner

### 6. Testing & Quality Assurance

**Best Practices:**
- **Test Coverage**: Critical paths and edge cases covered
- **Test Organization**: Mirrors source structure
- **Test Naming**: Descriptive test names (test_should_reject_invalid_email)
- **Arrange-Act-Assert**: Clear test structure
- **Isolation**: Tests don't depend on each other or external state
- **Mocking**: External dependencies mocked appropriately

**Structure:**
```
project/
  src/
    module.py
  tests/
    test_module.py
```

**Red Flags:**
- No tests at all
- Tests that require specific execution order
- Tests that hit real external APIs/databases
- Single massive test function testing everything
- No assertions or weak assertions (assertTrue(response))

### 7. Security & Safety

**Best Practices:**
- **No Hardcoded Secrets**: Use environment variables or secret managers
- **Input Sanitization**: Validate and sanitize all external input
- **SQL Injection Prevention**: Use parameterized queries
- **XSS Prevention**: Escape output, use framework protections
- **Authentication**: Proper session management, secure password storage
- **HTTPS**: All external communications encrypted
- **Dependency Updates**: Regular updates for security patches

**Red Flags:**
- API keys, passwords, tokens in code
- String concatenation for SQL queries
- Unsanitized user input rendered in HTML
- Passwords stored in plain text
- Disabled security features (certificate verification, CSRF protection)
- eval() or exec() with user input

### 8. Performance & Optimization

**Best Practices:**
- **Appropriate Data Structures**: Use right tool for the job
- **Avoid Premature Optimization**: Optimize hot paths after profiling
- **Database Queries**: Select only needed columns, proper indexing
- **Caching**: Cache expensive operations when appropriate
- **Resource Management**: Close files, connections, streams
- **Async Where Appropriate**: Use async for I/O-bound operations

**Common Issues:**

```python
# Bad - N+1 query problem
for user in users:
    orders = db.query(Order).filter_by(user_id=user.id).all()

# Good - join or prefetch
users = db.query(User).options(joinedload(User.orders)).all()

# Bad - list when set is better
if item in item_list:  # O(n) for list

# Good
if item in item_set:  # O(1) for set
```

**Red Flags:**
- Using list where set/dict would be better (membership testing)
- Loading entire dataset into memory when streaming would work
- Synchronous code for I/O operations in async frameworks
- Repeated database queries in loops
- No pagination for large datasets

### 9. AI-Generated Code Tells

These patterns often indicate AI-generated code that hasn't been reviewed by a human:

**Overly Verbose:**
```python
# AI-like
def process_user_data_and_return_result(user_data_input):
    """
    This function processes user data and returns the result.
    
    Parameters:
    user_data_input (dict): A dictionary containing user data
    
    Returns:
    dict: A dictionary containing the processed result
    """
    result_to_return = {}
    # ... unnecessarily verbose variable names throughout

# Human-like
def process_user(user):
    """Process user data and return validation results."""
    result = {}
    # ... concise, clear code
```

**Overly Generic Error Handling:**
```python
# AI-like
try:
    result = some_operation()
except Exception as e:
    print(f"An error occurred: {e}")
    return None

# Human-like
try:
    result = some_operation()
except ValueError as e:
    logger.error(f"Invalid input data: {e}")
    raise
except ConnectionError as e:
    logger.warning(f"Connection failed, retrying: {e}")
    return retry_operation()
```

**Perfect but Impractical Code:**
- Every function has detailed docstrings (even trivial ones)
- Excessive type hints on obvious types
- Over-engineered solutions for simple problems
- No TODOs, no rough edges, no "good enough" solutions
- Unnatural perfection (real code has some messiness)

**Cookie-Cutter Patterns:**
- Identical comment structures across all functions
- Same error handling pattern everywhere (even where inappropriate)
- Consistent use of verbose variable names (inputData, outputData, resultValue)

### 10. Language & Framework-Specific Conventions

**Python:**
- Pythonic idioms (list comprehensions, context managers, generators)
- Use of standard library (itertools, collections, pathlib)
- Type hints for public APIs (Python 3.5+)
- f-strings for formatting (Python 3.6+)
- dataclasses or attrs for data containers (Python 3.7+)

**JavaScript/TypeScript:**
- Async/await over promise chains
- Destructuring where appropriate
- Spread operator for object/array operations
- Optional chaining (?.) and nullish coalescing (??)
- Modern array methods (map, filter, reduce)

**Go:**
- Composition over inheritance
- Error handling idiom (if err != nil)
- Defer for cleanup
- Goroutines and channels for concurrency
- Meaningful zero values

**Rust:**
- Ownership and borrowing patterns
- Result and Option types (no nulls)
- Match expressions for error handling
- Traits over inheritance
- Use of iterators and combinators

## Review Process

### Step 1: Repository Analysis

1. **Scan the repository structure** using view tool on the root directory
2. **Identify the primary language(s)** and frameworks
3. **Locate key files**: README, requirements/package.json, tests, configs
4. **Understand the project type**: web app, CLI tool, library, etc.

### Step 2: Sample File Review

Select representative files from different areas:
- Main entry point
- Core business logic
- Data models
- API endpoints/handlers
- Utility functions
- Test files

### Step 3: Systematic Analysis

For each reviewed file, check:
1. **Structure**: Logical organization, proper imports
2. **Naming**: Consistent with language conventions
3. **Style**: Formatting, whitespace, consistency
4. **Logic**: Error handling, edge cases, efficiency
5. **Documentation**: Appropriate comments, docstrings
6. **Testing**: Test coverage and quality
7. **Security**: No obvious vulnerabilities

### Step 4: Pattern Recognition

Look for:
- **Consistency**: Same patterns throughout or inconsistent?
- **Maturity**: Sign of refactoring or first-draft code?
- **Experience**: Idiomatic code or fighting the language?
- **AI Tells**: Overly verbose, generic, or cookie-cutter code?

## Reporting Findings

### Structure Your Report

**1. Summary**
- Overall assessment (Professional / Needs Work / Beginner-level)
- Key strengths
- Top 3-5 areas for improvement

**2. Critical Issues**
List issues that should be addressed before production:
- Security vulnerabilities
- Major bugs or logic errors
- Significant performance problems

**3. Best Practice Violations**
Organized by category:
- Project structure issues
- Naming convention problems
- Error handling gaps
- Missing tests
- Documentation needs

**4. Convention & Style Issues**
- Language-specific violations
- Inconsistencies in codebase
- "Code smell" patterns
- Potential AI-generated code indicators

**5. Positive Observations**
- What the code does well
- Good patterns to maintain
- Strong areas of the codebase

**6. Recommendations**
Prioritized action items:
- Must fix (security, bugs)
- Should fix (best practices)
- Nice to have (style, optimization)

### Tone & Delivery

- **Be constructive**: Focus on improvement, not criticism
- **Be specific**: Point to exact files and line numbers when possible
- **Explain why**: Don't just say "this is wrong," explain the impact
- **Acknowledge context**: Consider project maturity and team size
- **Balance criticism**: Mention what's done well
- **Prioritize**: Not everything needs fixing immediately

### Example Output Format

```markdown
## Code Review Summary

**Overall Assessment**: Professional with some areas for improvement

**Strengths**:
- Well-organized project structure following Django conventions
- Comprehensive test coverage (87%)
- Good use of type hints throughout

**Top Priorities**:
1. Address hardcoded API keys in settings.py
2. Add input validation to user-facing endpoints
3. Refactor 450-line view function into smaller pieces

---

## Critical Issues

### 🔴 Security: Hardcoded Credentials
**File**: `src/settings.py:45`
```python
API_KEY = "sk-abc123def456..."  # Don't commit this!
```
**Impact**: API key exposed in version control
**Fix**: Use environment variables: `API_KEY = os.getenv('API_KEY')`

---

## Best Practice Violations

### Project Structure

**Issue**: Test files mixed with source code
**Files**: `src/models.py`, `src/test_models.py`
**Recommendation**: Move all tests to `tests/` directory

### Naming Conventions

**Issue**: Inconsistent function naming
**Examples**:
- `getUserById()` (camelCase) in `users.py:23`
- `get_user_by_email()` (snake_case) in `users.py:45`
**Fix**: Use snake_case consistently for Python functions

---

## Convention & Style Issues

### AI-Generated Code Indicators

**Pattern**: Overly verbose variable naming
**Example** (`utils.py:78`):
```python
def process_user_input_data_and_return_validated_result(user_input_data):
    validated_result_to_return = {}
    # ...
```
**Recommendation**: More natural naming:
```python
def validate_user_input(input_data):
    result = {}
    # ...
```

---

## Positive Observations

✅ Excellent use of Django ORM best practices
✅ Comprehensive docstrings on all public APIs  
✅ Good test coverage with meaningful test names
✅ Proper use of async views for I/O-bound operations

---

## Recommendations

**High Priority**:
1. Remove hardcoded credentials (security)
2. Add input validation to all endpoints (security)
3. Fix N+1 query in dashboard view (performance)

**Medium Priority**:
4. Standardize naming conventions across codebase
5. Add error handling to external API calls
6. Reorganize test files into separate directory

**Low Priority**:
7. Add type hints to remaining untyped functions
8. Consider breaking up large view functions
9. Update docstrings to include exception information


## Common Mistakes to Avoid in Reviews

1. **Being Too Harsh**: Remember the goal is improvement, not perfection
2. **Nitpicking Style**: Focus on substance over minor style differences
3. **Missing the Forest**: Don't get lost in details; consider overall architecture
4. **Ignoring Context**: A prototype has different standards than production code
5. **Assuming Malice**: Often issues are due to inexperience, not carelessness
6. **Being Too Vague**: "This is bad" doesn't help; explain what and why
7. **Focusing Only on Negatives**: Positive reinforcement matters

## Tool Usage

Use these tools effectively:
- `view` to examine files and directory structure
- `bash_tool` to run linters/formatters if needed (pylint, eslint, gofmt)
- `bash_tool` to check for secrets (git secrets, truffleHog)
- `bash_tool` to run tests and see coverage reports

## Conclusion

A good code review should leave the developer feeling:
- Clear on what needs to change and why
- Empowered with specific, actionable feedback
- Confident about what they're doing well
- Educated about best practices and conventions
- Motivated to improve (not discouraged)

Remember: Professional code isn't perfect code. It's maintainable, secure, tested, and follows conventions that make it easy for other humans (not just AI) to understand and modify.
