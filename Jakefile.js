
var fs = require('fs'),
    path = require('path'),
    child_process = require('child_process'),
    rexp_minified = new RegExp("\\.min\\.js$"),
    rexp_src = new RegExp('\\.js$'),
    version;

// Modified from lukebayes: http://gist.github.com/814063
function forEachFile(root, cbFile, cbDone) {
    var count = 0;

    function scan(name) {
        ++count;

        fs.stat(name, function (err, stats) {
            if (err) cbFile(err);

            if (stats.isDirectory()) {
                fs.readdir(name, function (err, files) {
                    if (err) cbFile(err);

                    files.forEach(function (file) {
                        scan(path.join(name, file));
                    });
                    done();
                });
            } else if (stats.isFile()) {
                cbFile(null, name, stats, done);
            } else {
                done();
            }
        });
    }

    function done() {
        --count;
        if (count === 0 && cbDone) cbDone();
    }

    scan(root);
}

desc('Pulls the current version from lib/sammy.js');
task('version', function () {
    var sammyjs = fs.readFileSync('lib/sammy.js'),
        regex_version = new RegExp("Sammy.VERSION = '([\\d\\w\\.]+)'");
    version = regex_version.exec(sammyjs)[1];
    console.log("VERSION: " + version);
});

desc('Uses Uglify-js to minify lib/sammy.js and all plugins');
task({ 'minify': [ 'version' ] }, function () {

    forEachFile('lib', function (err, file, stats, cbDone) {
        if (err) throw err;

        if (!rexp_minified.test(file)) {
            cbDone();
        } else {
            fs.unlink(file, function (err) {
                if (err) throw err;
                cbDone();
            });
        }
    }, function() {
        var rexp_base_name = new RegExp("^lib/(.+)\\.js$"),
            jsp = require("uglify-js").parser,
            pro = require("uglify-js").uglify,
            dateformatjs = require('dateformatjs'),
            dateformat = new dateformatjs.DateFormat(dateformatjs.DateFormat.ISO8601);

        forEachFile('lib', function (err, file, stats, cbDone) {
            if (err) throw err;

            var m = rexp_base_name.exec(file);
            if (!m) {
                cbDone();
            } else {
                fs.readFile(file, 'utf8', function (err, src) {
                    if (err) throw err;

                    var minified = [
                            "// -- Sammy.js -- " + m[1] + ".js",
                            "// http://sammyjs.org",
                            "// Version: " + version,
                            "// Built: " + dateformat.format(new Date()) + "\n"
                        ].join("\n") + pro.gen_code(pro.ast_squeeze(pro.ast_mangle(jsp.parse(src)))),
                        dir = 'lib/min';
                    fs.writeFile(path.join(dir, m[1] + "-" + version + ".min.js"), minified, function (err) {
                        if (err) throw err;

                        fs.writeFile(path.join(dir, m[1] + "-latest.min.js"), minified, function (err) {
                            if (err) throw err;

                            console.log("Minified " + file);
                            cbDone();
                        });
                    });
                });
            }
        }, function() {
            console.log('Done.');
            complete();
        });
    });
}, true);

function simple_exec(cmd, cbDone) {
    child_process.exec(cmd, function (err, stdout, stderr) {
        if (stdout) console.log(stdout);
        if (stderr) console.error(stderr);
        if (err) throw err;
        if (cbDone) cbDone();
    });
}

function run_tests() {
    var cmd = process.env.TEST_CMD,
        test = process.env.TEST || path.join(__dirname, 'test', 'index.html');

    if (!cmd) cmd = '/usr/bin/gnome-open';

    if (fs.statSync(cmd).isFile()) {
        simple_exec(cmd + ' ' + test);
    } else {
        simple_exec('open ' + test);
    }
}


// Modified from peterc: http://gist.github.com/113226
desc("Automatically run something when code is changed");
task('autotest', function () {
    var files = {};

    function run() {
        var changed = false;

        forEachFile(__dirname, function (err, file, stats, cbDone) {
            if (err) throw err;

            var ctime = stats.ctime.toString();

            if (rexp_src.test(file) && ctime !== files[file]) {
                files[file] = ctime;
                if (!changed) {
                    changed = true;
                    console.log("Running at " + new Date());
                    run_tests();
                }
            }
            cbDone();
        }, function () {
            if (changed) console.log("\nWaiting for a *.js change.");
            setTimeout(run, 1000);
        });
    }

    run();
});

desc('launch the test file in the browser');
task('test', function () {
    run_tests();
});

desc('Tag with the current version');
task({ 'tag': [ 'version' ] }, function () {
    simple_exec([
        "git add .",
        "git commit -a -m'Pushing version " + version + "'",
        "git tag v" + version,
        "git push --tags"
    ].join(' && '));
});

desc('Prepare for release.');
task({ 'release': [ 'minify' ] }, function () {
    jake.Task.tag.invoke();
});

desc('Generate the docs for the current version to DIR');
task({ 'docs': [ 'version' ] }, function () {
    if (process.env.VERSION) version = process.env.VERSION;

    simple_exec("ruby vendor/jsdoc/jsdoc.rb '" + process.env.DIR + "' '" + version + "' lib/ lib/plugins/");
});

desc('Check sources with JSHint.');
task('lint', function () {
    var lint = [ './node_modules/.bin/jshint', 'Jakefile.js' ];

    forEachFile('lib', function (err, file, stats, cbDone) {
        if (err) throw err;

        if (!rexp_minified.test(file) && rexp_src.test(file)) {
            lint.push(file);
        }
        cbDone();
    }, function() {
        child_process.exec(lint.join(' '), function (err, stdout, stderr) {
            if (stdout) console.log(stdout);
            if (stderr) console.error(stderr);
            if (err && err.code !== 1) throw err;
            complete();
        });
    });
}, true);
