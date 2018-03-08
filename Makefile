default: build

PACKAGES := node_modules/.packages.build
SEMANTIC := semantic/dist/.semantic.build
BOWER := components/.bower.build
GRUNT := dist/.grunt.build
LINT := .lint.pass
TEST := .test.pass
BUILD := dist/build.json

export ATLAS_URL ?= https://atlas-dev.forsta.io
export ATLAS_UI_URL ?= https://app-dev.forsta.io
export SIGNAL_URL ?= https://forsta-signalserver-dev.herokuapp.com
export RESET_CACHE ?= 1
export NO_MINIFY ?= 1

packages: $(PACKAGES)
semantic: $(SEMANTIC)
bower: $(BOWER)
grunt: $(GRUNT)

NPATH := $(shell pwd)/node_modules/.bin
SRC := $(shell find app lib stylesheets -type f)

########################################################
# Building & cleaning targets
########################################################

$(PACKAGES): package.json
	npm install
	touch $@

$(SEMANTIC): $(PACKAGES) $(shell find semantic/src semantic/tasks -type f)
	cd semantic && $(NPATH)/gulp build
	touch $@

$(BOWER): $(PACKAGES) bower.json Makefile
	if [ -n "$$GITHUB_AUTH_TOKEN" ] ; then \
	    git config --global credential.helper "$$PWD/.heroku_env_auth"; \
	fi
	$(NPATH)/bower install
	touch $@

ifneq ($(NODE_ENV),production)
$(LINT): $(SRC)
	$(NPATH)/eslint app lib worker
	touch $@

$(TEST): $(SRC) $(shell find tests -type f)
	node tests/forstaDownTest.js
	touch $@
else
$(LINT):
	touch $@

$(TEST):
	touch $@
endif

$(GRUNT): $(BOWER) $(SEMANTIC) Gruntfile.js $(SRC) $(LINT) Makefile
	$(NPATH)/grunt default
	touch $@

$(BUILD): $(GRUNT) $(TEST) Makefile
	echo '{"git_commit": "$(or $(SOURCE_VERSION),$(shell git rev-parse HEAD))"}' > $@

clean:
	rm -rf $(PACKAGES) $(SEMANTIC) $(BOWER) $(GRUNT) dist builds

realclean: clean
	rm -rf node_modules components

build: $(BUILD)

lint: $(LINT)

test: $(TEST)

########################################################
# Runtime-only targets
########################################################
watch:
	$(NPATH)/grunt watch

run: $(BUILD)
	node server/start.js

forcerun:
	node server/start.js

run-electron: $(BUILD)
	$(NPATH)/electron .

electron: $(BUILD)
	$(NPATH)/electron-packager . \
		--overwrite \
		--icon images/app.icns \
		--out builds \
		--ignore '^/Procfile' \
		--ignore '^/app' \
		--ignore '^/audio' \
		--ignore '^/build' \
		--ignore '^/components' \
		--ignore '^/fonts' \
		--ignore '^/html' \
		--ignore '^/images' \
		--ignore '^/lib' \
		--ignore '^/references' \
		--ignore '^/semantic' \
		--ignore '^/stylesheets' \
		--ignore '^/templates' \
		--ignore '^/tests' \
		--ignore '^/worker' \
		--ignore '^/node_modules/semantic-ui' \
		--ignore '^/node_modules/librelay-web' \
		--ignore '^/node_modules/libsignal-protocol' \
		--ignore '^/node_modules/bower' \
		--ignore '^/node_modules/.*emoji.*'


.PHONY: electron
