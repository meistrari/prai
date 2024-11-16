Here's the documentation of errors that the AI should catch, categorized by difficulty and severity:

### Easy Level Errors

1. **UserService.ts**
- 🔴 Critical: Hardcoded database credentials in constructor
- 🔴 Critical: SQL injection vulnerability in all queries
- 🔴 Critical: Using MD5 for password hashing (insecure)
- 🟡 Warning: Untyped userData parameter (any type)

2. **TransactionProcessor.ts**
- 🔴 Critical: Hardcoded API key in code
- 🟡 Warning: Untyped cardDetails parameter
- 🟡 Warning: Sequential processing in bulkProcess (performance)
- 🟢 Info: Missing transaction logging

3. **DatabaseConnection.ts**
- 🔴 Critical: Hardcoded database credentials
- 🟡 Warning: No connection pooling
- 🟡 Warning: No timeout handling
- 🟢 Info: Console.log in production code

### Medium Level Errors

4. **OrderController.ts**
- 🔴 Critical: SQL injection in queries
- 🔴 Critical: No input validation
- 🟡 Warning: Missing error handling
- 🟡 Warning: No transaction wrapping for order creation
- 🟡 Warning: Implicit global 'db' variable usage

5. **CacheManager.ts**
- 🟡 Warning: No cache size limits
- 🟡 Warning: No expired items cleanup mechanism
- 🟡 Warning: Singleton pattern could cause testing issues
- 🟢 Info: Missing cache hit/miss metrics

6. **DataTransformer.ts**
- 🟡 Warning: Inefficient sequential processing in processLargeDataset
- 🟡 Warning: Untyped parameters (any)
- 🟡 Warning: Potential memory issues with large datasets
- 🟢 Info: Missing progress tracking

7. **LogProcessor.ts**
- 🔴 Critical: Hardcoded file path
- 🟡 Warning: No log rotation handling
- 🟡 Warning: Potential memory issues with large logs
- 🟢 Info: Silent error swallowing in JSON.parse

### Hard Level Errors (Requires Deep Analysis)

8. **RateLimiter.ts**
- 🔴 Critical: Memory leak (no cleanup of old requests)
- 🟡 Warning: Race conditions in checkLimit
- 🟡 Warning: No distributed rate limiting support
- 🟢 Info: Missing rate limit headers

9. **DataProcessor.ts**
- 🔴 Critical: Race condition in processData
- 🟡 Warning: No error handling in processing loop
- 🟡 Warning: No backpressure mechanism
- 🟡 Warning: Potential memory leaks
- 🟢 Info: Missing processing metrics

10. **ConfigLoader.ts**
- 🔴 Critical: No error handling for missing config file
- 🟡 Warning: Race condition in loadConfig
- 🟡 Warning: No config validation
- 🟡 Warning: No environment variables support
- 🟢 Info: Missing config reload capability

### Ambiguous Severity Cases (AI Challenge)

1. **Data Validation**
- OrderController's total calculation (Could be Critical or Warning depending on business context)
- DataTransformer's type conversion (Warning or Info depending on data usage)

2. **Performance Issues**
- CacheManager's lack of cleanup (Warning or Critical depending on memory constraints)
- DataProcessor's sequential processing (Warning or Critical depending on scale)

3. **Error Handling**
- LogProcessor's silent catches (Warning or Critical depending on log importance)
- ConfigLoader's error throwing (Warning or Critical depending on application criticality)

4. **Security**
- RateLimiter's IP-based limiting (Warning or Critical depending on infrastructure)
- DatabaseConnection's logging (Warning or Critical depending on log content)

This test suite provides a comprehensive evaluation of the AI's ability to:
- Identify security vulnerabilities
- Spot performance issues
- Detect architectural problems
- Assess severity appropriately
- Handle ambiguous cases
- Provide appropriate remediation suggestions

The AI should not only identify these issues but also provide appropriate code suggestions for fixing them, considering the context and potential trade-offs in each case.