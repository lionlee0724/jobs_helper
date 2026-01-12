const fs = require('fs');
const path = require('path');

// Load the script content
const scriptPath = path.resolve(__dirname, '../../Universal_Job_Helper.js');
const scriptContent = fs.readFileSync(scriptPath, 'utf8');

describe('Universal Job Helper Core Tests', () => {
    let Core;
    let JobStrategy;

    beforeAll(() => {
        // Evaluate the script in the current environment
        // We rely on window.JobHelper being exported
        eval(scriptContent);
        
        if (!window.JobHelper) {
            throw new Error('window.JobHelper not found! Check if script exports it.');
        }
        Core = window.JobHelper.Core;
        JobStrategy = window.JobHelper.JobStrategy;
    });

    describe('Core.extractTwoCharKeywords', () => {
        test('should extract 2-char keywords correctly', () => {
            const text = "你好世界";
            const keywords = Core.extractTwoCharKeywords(text);
            // "你好", "好世", "世界"
            expect(keywords).toEqual(["你好", "好世", "世界"]);
        });

        test('should ignore punctuation', () => {
            const text = "你好，世界";
            const keywords = Core.extractTwoCharKeywords(text);
            // "你好", "世界" (punctuation removed before processing)
            expect(keywords).toEqual(["你好", "世界"]);
        });

        test('should handle empty input', () => {
            expect(Core.extractTwoCharKeywords("")).toEqual([]);
            expect(Core.extractTwoCharKeywords(null)).toEqual([]);
        });
    });

    describe('JobStrategy.shouldProcessByKeywords', () => {
        let strategy;

        beforeEach(() => {
            // Instantiate a dummy strategy to use the method
            strategy = new (class extends JobStrategy {})();
        });

        test('should match basic keywords', () => {
            const text = "高级前端工程师";
            const keywords = "前端, Java";
            expect(strategy.shouldProcessByKeywords(text, keywords)).toBe(true);
        });

        test('should return false when no match', () => {
            const text = "高级前端工程师";
            const keywords = "Java, Python";
            expect(strategy.shouldProcessByKeywords(text, keywords)).toBe(false);
        });

        test('should ignore case', () => {
            const text = "Senior Java Developer";
            const keywords = "java";
            expect(strategy.shouldProcessByKeywords(text, keywords)).toBe(true);
        });

        test('should return true if no keywords provided', () => {
            expect(strategy.shouldProcessByKeywords("text", "")).toBe(true);
            expect(strategy.shouldProcessByKeywords("text", null)).toBe(true);
        });
        
        test('should handle Chinese comma', () => {
            const text = "前端开发";
            const keywords = "后端，前端";
            expect(strategy.shouldProcessByKeywords(text, keywords)).toBe(true);
        });
    });
});
