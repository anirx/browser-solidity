/* global Node, requestAnimationFrame */
var yo = require('yo-yo')
var javascriptserialize = require('javascript-serialize')
var jsbeautify = require('js-beautify')
var type = require('component-type')
var vm = require('vm')
var remixLib = require('remix-lib')
var EventManager = remixLib.EventManager
var Web3 = require('web3')

var executionContext = require('../../execution-context')
var Dropdown = require('../ui/dropdown')
// -------------- styling ----------------------
var csjs = require('csjs-inject')
var styleGuide = remixLib.ui.styleGuide
var styles = styleGuide()

var css = csjs`
  .panel              {
    position          : relative;
    display           : flex;
    flex-direction    : column;
    font-size         : 12px;
    color             : ${styles.terminal.text_Regular_TransactionLog};
    background-color  : ${styles.terminal.backgroundColor_Terminal};
    height            : 100%;
    min-height        : 1.7em;
    overflow          : hidden;
  }
  .bar                {
    display           : flex;
    min-height        : 3em;
    padding           : 2px;
    background-color  : ${styles.terminal.backgroundColor_Menu};
    z-index           : 3;
  }
  .menu               {
    color             : ${styles.terminal.text_Primary};
    position          : relative;
    display           : flex;
    align-items       : center;
    width             : 100%;
    padding           : 5px;
  }
  .clear           {
    margin-left       : 10px;
    margin-right      : 10px; 
    width             : 10px;
    cursor            : pointer;
    color             : ${styles.terminal.icon_Color_TogglePanel};
  }
  .clear:hover              {
    color             : ${styles.terminal.icon_HoverColor_Menu};
  }
  .toggleTerminal              {
    margin-right      : 10px;
    font-size         : 14px;
    font-weight       : bold;
    cursor            : pointer;
    color             : ${styles.terminal.icon_Color_Menu};
  }
  .toggleTerminal:hover              {
    color             : ${styles.terminal.icon_HoverColor_TogglePanel};
  }
  .terminal_container {
    background-color  : ${styles.terminal.backgroundColor_Terminal};
    display           : flex;
    flex-direction    : column;
    height            : 100%;
    overflow-y        : auto;
    font-family       : monospace;
  }
  .terminal_bg     {
    display           : flex;
    flex-direction    : column;
    height            : 100%;
    padding-left      : 5px;
    padding-right     : 5px;
    padding-bottom    : 3px;
    overflow-y        : auto;
    font-family       : monospace;
    background-image  : ${styles.terminal.backgroundImage_Terminal};
    opacity           : 0.1;
    top               : 15%;
    left              : 33%;
    bottom            : 0;
    right             : 0;
    position          : absolute;
    background-repeat : no-repeat;
    background-size   : 45%;
  }
  .terminal    {
    position: relative;
    display: flex;
    flex-direction: column;
    height: 100%;
  }
  .journal            {
    margin-top        : auto;
    font-family       : monospace;
  }
  .block              {
    word-break        : break-all;
    white-space       : pre-wrap;
    line-height       : 2ch;
    margin            : 1ch;
    margin-top        : 2ch;
  }
  .cli                {
    line-height       : 1.7em;
    font-family       : monospace;
    background-color  : ${styles.terminal.backgroundColor_TerminalCLI};
    padding           : .4em;
    color             : ${styles.appProperties.mainText_Color};
    border-top        : solid 2px ${styles.terminal.bar_Ghost};
  }
  .prompt             {
    margin-right      : 0.5em;
    font-family       : monospace;
    font-weight       : bold;
    font-size         : large;
    color             : ${styles.appProperties.supportText_OppositeColor};
  }
  .input              {
    word-break        : break-all;
    outline           : none;
    font-family       : monospace;
  }
  .search {
    display: flex;
    align-items: center;
    margin-right: 10px;
  }
  .filter             {
    ${styles.terminal.input_Search_MenuBar}
    width                       : 200px;
    padding-right               : 0px;
    margin-right                : 0px;
    border-top-left-radius      : 0px;
    border-bottom-left-radius   : 0px;
  }
  .searchIcon {
    background-color            : ${styles.colors.veryLightGrey};
    color                       : ${styles.terminal.icon_Color_Menu};
    height                      : 25px;
    width                       : 25px;
    border-top-left-radius      : 3px;
    border-bottom-left-radius   : 3px;
    display                     : flex;
    align-items                 : center;
    justify-content             : center;
  }
  .listen {
    min-width         : 120px;
    display           : flex;
  }
  .dragbarHorizontal  {
    position          : absolute;
    top               : 0;
    height            : 0.5em;
    right             : 0;
    left              : 0;
    cursor            : ns-resize;
    z-index           : 999;
    border-top        : 2px solid ${styles.terminal.bar_Dragging};
  }
  .ghostbar           {
    position          : absolute;
    height            : 6px;
    background-color  : ${styles.terminal.bar_Ghost};
    opacity           : 0.5;
    cursor            : row-resize;
    z-index           : 9999;
    left              : 0;
    right             : 0;
  }
`

var KONSOLES = []

function register (api) { KONSOLES.push(api) }

var ghostbar = yo`<div class=${css.ghostbar}></div>`

class Terminal {
  constructor (opts = { auto: true }) {
    var self = this
    self.event = new EventManager()
    self._api = opts.api
    self.data = {
      lineLength: opts.lineLength || 80,
      session: [],
      activeFilters: { commands: {}, input: '' },
      filterFns: {}
    }
    self._view = { el: null, bar: null, input: null, term: null, journal: null, cli: null }
    self._components = {}
    self._components.dropdown = new Dropdown({
      options: [
        'only remix transactions',
        'all transactions',
        'script'
      ],
      defaults: ['only remix transactions', 'script'],
      dependencies: {'all transactions': ['only remix transactions'], 'only remix transactions': ['all transactions']}
    })
    self._components.dropdown.event.register('deselect', function (label) {
      self.event.trigger('filterChanged', ['deselect', label])
      if (label === 'script') {
        self.updateJournal({ type: 'deselect', value: label })
      }
    })
    self._components.dropdown.event.register('select', function (label) {
      self.event.trigger('filterChanged', ['select', label])
      if (label === 'script') {
        self.updateJournal({ type: 'select', value: label })
      }
    })
    self._commands = {}
    self.commands = {}
    self._JOURNAL = []
    self._jobs = []
    self._INDEX = {}
    self._INDEX.all = []
    self._INDEX.allMain = []
    self._INDEX.commands = {}
    self._INDEX.commandsMain = {}
    self.registerCommand('log', self._blocksRenderer('log'), { activate: true })
    self.registerCommand('info', self._blocksRenderer('info'), { activate: true })
    self.registerCommand('error', self._blocksRenderer('error'), { activate: true })
    self.registerCommand('script', function execute (args, scopedCommands, append) {
      var script = String(args[0])
      scopedCommands.log(`> ${script}`)
      self._shell(script, scopedCommands, function (error, output) {
        if (error) scopedCommands.error(error)
        else scopedCommands.log(output)
      })
    }, { activate: true })
    function basicFilter (value, query) { try { return value.indexOf(query) !== -1 } catch (e) { return false } }

    self.registerFilter('log', basicFilter)
    self.registerFilter('info', basicFilter)
    self.registerFilter('error', basicFilter)
    self.registerFilter('script', basicFilter)

    self._jsSandboxContext = {}
    self._jsSandbox = vm.createContext(self._jsSandboxContext)
    if (opts.shell) self._shell = opts.shell
    register(self)
  }
  render () {
    var self = this
    if (self._view.el) return self._view.el
    self._view.journal = yo`<div class=${css.journal}></div>`
    self._view.input = yo`
      <span class=${css.input} contenteditable="true" onkeydown=${change}></span>
    `
    self._view.input.innerText = '\n'
    self._view.cli = yo`
      <div class=${css.cli}>
        <span class=${css.prompt}>${'>'}</span>
        ${self._view.input}
      </div>
    `
    self._view.icon = yo`<i onmouseenter=${hover} onmouseleave=${hover} onmousedown=${minimize} class="${css.toggleTerminal} fa fa-angle-double-down"></i>`
    self._view.dragbar = yo`<div onmousedown=${mousedown} class=${css.dragbarHorizontal}></div>`
    self._view.dropdown = self._components.dropdown.render()
    self._view.bar = yo`
      <div class=${css.bar}>
        ${self._view.dragbar}
        <div class=${css.menu}>
          ${self._view.icon}
          <div class=${css.clear} onclick=${clear}>
          <i class="fa fa-ban" aria-hidden="true" onmouseenter=${hover} onmouseleave=${hover}></i>
          </div>
          ${self._view.dropdown}
          <div class=${css.search}><i class="fa fa-search ${css.searchIcon}" aria-hidden="true"></i><input type="text" class=${css.filter} onkeydown=${filter}  placeholder="Search transactions"></div>
          <div class=${css.listen}><input onchange=${listenOnNetwork} type="checkbox"><label title="If checked Remix will listen on all transactions mined in the current environment and not only transactions created from the GUI">Listen on network</label></div>
        </div>
      </div>
    `
    function listenOnNetwork (ev) {
      self.event.trigger('listenOnNetWork', [ev.currentTarget.checked])
    }

    self._view.term = yo`
      <div class=${css.terminal_container} onscroll=${throttle(reattach, 10)} onclick=${focusinput}>
        <div class=${css.terminal_bg}>
        </div>
        <div class=${css.terminal}>
            ${self._view.journal}
            ${self._view.cli}
        </div>
      </div>
    `
    self._view.el = yo`
      <div class=${css.panel}>
        ${self._view.bar}
        ${self._view.term}
      </div>
    `

    function throttle (fn, wait) {
      var time = Date.now()
      return function debounce () {
        if ((time + wait - Date.now()) < 0) {
          fn.apply(this, arguments)
          time = Date.now()
        }
      }
    }
    var css2 = csjs`
      .anchor            {
        position         : static;
        border-top       : 2px dotted blue;
        height           : 10px;
      }
      .overlay           {
        position         : absolute;
        width            : 100%;
        display          : flex;
        align-items      : center;
        justify-content  : center;
        bottom           : 0;
        right            : 15px;
        min-height       : 20px;
      }
      .text              {
        z-index          : 2;
        color            : black;
        font-weight      : bold;
        pointer-events   : none;
      }
      .background        {
        z-index          : 1;
        opacity          : 0.8;
        background-color : #a6aeba;
        cursor           : pointer;
      }
    `
    var text = yo`<div class="${css2.overlay} ${css2.text}"></div>`
    var background = yo`<div class="${css2.overlay} ${css2.background}"></div>`
    var placeholder = yo`<div class=${css2.anchor}>${background}${text}</div>`
    var inserted = false

    window.addEventListener('resize', function (event) {
      self.event.trigger('resize', [])
      self.event.trigger('resize', [])
    })

    function focusinput (event) {
      if (self._view.journal.offsetHeight - (self._view.term.scrollTop + self._view.term.offsetHeight) < 50) {
        refocus()
      }
    }
    function refocus () {
      self._view.input.focus()
      reattach({ currentTarget: self._view.term })
      delete self.scroll2bottom
      self.scroll2bottom()
    }
    function reattach (event) {
      var el = event.currentTarget
      var isBottomed = el.scrollHeight - el.scrollTop - el.clientHeight < 30
      if (isBottomed) {
        if (inserted) {
          text.innerText = ''
          background.onclick = undefined
          self._view.journal.removeChild(placeholder)
        }
        inserted = false
        delete self.scroll2bottom
      } else {
        if (!inserted) self._view.journal.appendChild(placeholder)
        inserted = true
        check()
        if (!placeholder.nextElementSibling) {
          placeholder.style.display = 'none'
        } else {
          placeholder.style = ''
        }
        self.scroll2bottom = function () {
          var next = placeholder.nextElementSibling
          if (next) {
            placeholder.style = ''
            check()
            var messages = 1
            while ((next = next.nextElementSibling)) messages += 1
            text.innerText = `${messages} new unread log entries`
          } else {
            placeholder.style.display = 'none'
          }
        }
      }
    }
    function check () {
      var pos1 = self._view.term.offsetHeight + self._view.term.scrollTop - (self._view.el.offsetHeight * 0.15)
      var pos2 = placeholder.offsetTop
      if ((pos1 - pos2) > 0) {
        text.style.display = 'none'
        background.style.position = 'relative'
        background.style.opacity = 0.3
        background.style.right = 0
        background.style.borderBox = 'content-box'
        background.style.padding = '2px'
        background.style.height = (self._view.journal.offsetHeight - (placeholder.offsetTop + placeholder.offsetHeight)) + 'px'
        background.onclick = undefined
        background.style.cursor = 'default'
        background.style.pointerEvents = 'none'
      } else {
        background.style = ''
        text.style = ''
        background.onclick = function (event) {
          placeholder.scrollIntoView()
          check()
        }
      }
    }
    function hover (event) { event.currentTarget.classList.toggle(css.hover) }
    function minimize (event) {
      event.preventDefault()
      event.stopPropagation()
      if (event.button === 0) {
        var classList = self._view.icon.classList
        classList.toggle('fa-angle-double-down')
        classList.toggle('fa-angle-double-up')
        self.event.trigger('resize', [])
      }
    }
    var filtertimeout = null
    function filter (event) {
      if (filtertimeout) {
        clearTimeout(filtertimeout)
      }
      filtertimeout = setTimeout(() => {
        self.updateJournal({ type: 'search', value: document.querySelector('.' + event.target.className).value })
      }, 500)
    }
    function clear (event) {
      refocus()
      self._view.journal.innerHTML = ''
    }
    // ----------------- resizeable ui ---------------
    function mousedown (event) {
      event.preventDefault()
      if (event.which === 1) {
        moveGhostbar(event)
        document.body.appendChild(ghostbar)
        document.addEventListener('mousemove', moveGhostbar)
        document.addEventListener('mouseup', removeGhostbar)
        document.addEventListener('keydown', cancelGhostbar)
      }
    }
    function cancelGhostbar (event) {
      if (event.keyCode === 27) {
        document.body.removeChild(ghostbar)
        document.removeEventListener('mousemove', moveGhostbar)
        document.removeEventListener('mouseup', removeGhostbar)
        document.removeEventListener('keydown', cancelGhostbar)
      }
    }
    function moveGhostbar (event) { // @NOTE HORIZONTAL ghostbar
      ghostbar.style.top = self._api.getPosition(event) + 'px'
    }
    function removeGhostbar (event) {
      if (self._view.icon.classList.contains('fa-angle-double-up')) {
        self._view.icon.classList.toggle('fa-angle-double-down')
        self._view.icon.classList.toggle('fa-angle-double-up')
      }
      document.body.removeChild(ghostbar)
      document.removeEventListener('mousemove', moveGhostbar)
      document.removeEventListener('mouseup', removeGhostbar)
      document.removeEventListener('keydown', cancelGhostbar)
      self.event.trigger('resize', [self._api.getPosition(event)])
    }

    self._cmdHistory = []
    self._cmdIndex = -1
    self._cmdTemp = ''

    return self._view.el

    function change (event) {
      if (self._view.input.innerText.length === 0) self._view.input.innerText += '\n'
      if (event.which === 13) {
        if (event.ctrlKey) { // <ctrl+enter>
          self._view.input.innerText += '\n'
          putCursor2End(self._view.input)
          self.scroll2bottom()
        } else { // <enter>
          self._cmdIndex = -1
          self._cmdTemp = ''
          event.preventDefault()
          var script = self._view.input.innerText.trim()
          self._view.input.innerText = '\n'
          if (script.length) {
            self._cmdHistory.unshift(script)
            self.commands.script(script)
          }
        }
      } else if (event.which === 38) { // <arrowUp>
        var len = self._cmdHistory.length
        if (len === 0) return event.preventDefault()
        if (self._cmdHistory.length - 1 > self._cmdIndex) {
          self._cmdIndex++
        }
        self._view.input.innerText = self._cmdHistory[self._cmdIndex]
        putCursor2End(self._view.input)
        self.scroll2bottom()
      } else if (event.which === 40) { // <arrowDown>
        if (self._cmdIndex > -1) {
          self._cmdIndex--
        }
        self._view.input.innerText = self._cmdIndex >= 0 ? self._cmdHistory[self._cmdIndex] : self._cmdTemp
        putCursor2End(self._view.input)
        self.scroll2bottom()
      } else {
        self._cmdTemp = self._view.input.innerText
      }
    }
    function putCursor2End (editable) {
      var range = document.createRange()
      range.selectNode(editable)
      var child = editable
      var chars

      while (child) {
        if (child.lastChild) child = child.lastChild
        else break
        if (child.nodeType === Node.TEXT_NODE) {
          chars = child.textContent.length
        } else {
          chars = child.innerHTML.length
        }
      }

      range.setEnd(child, chars)
      var toStart = true
      var toEnd = !toStart
      range.collapse(toEnd)

      var sel = window.getSelection()
      sel.removeAllRanges()
      sel.addRange(range)

      editable.focus()
    }
  }
  updateJournal (filterEvent) {
    var self = this
    var commands = self.data.activeFilters.commands
    var value = filterEvent.value
    if (filterEvent.type === 'select') {
      commands[value] = true
      if (!self._INDEX.commandsMain[value]) return
      self._INDEX.commandsMain[value].forEach(item => {
        item.root.steps.forEach(item => { self._JOURNAL[item.gidx] = item })
        self._JOURNAL[item.gidx] = item
      })
    } else if (filterEvent.type === 'deselect') {
      commands[value] = false
      if (!self._INDEX.commandsMain[value]) return
      self._INDEX.commandsMain[value].forEach(item => {
        item.root.steps.forEach(item => { self._JOURNAL[item.gidx] = undefined })
        self._JOURNAL[item.gidx] = undefined
      })
    } else if (filterEvent.type === 'search') {
      if (value !== self.data.activeFilters.input) {
        var query = self.data.activeFilters.input = value
        var items = self._JOURNAL
        for (var gidx = 0, len = items.length; gidx < len; gidx++) {
          var item = items[gidx]
          if (item && self.data.filterFns[item.cmd]) {
            var show = query.length ? self.data.filterFns[item.cmd](item.args, query) : true
            item.hide = !show
          }
        }
      }
    }
    var df = document.createDocumentFragment()
    self._JOURNAL.forEach(item => {
      if (item && item.el && !item.hide) df.appendChild(item.el)
    })
    requestAnimationFrame(function updateDOM () {
      self._view.journal.innerHTML = ''
      self._view.journal.appendChild(df)
    })
  }
  _appendItem (item) {
    var self = this
    var { el, gidx } = item
    self._JOURNAL[gidx] = item
    if (!self._jobs.length) {
      requestAnimationFrame(function updateTerminal () {
        self._jobs.forEach(el => self._view.journal.appendChild(el))
        self.scroll2bottom()
        self._jobs = []
      })
    }
    self._jobs.push(el)
  }
  scroll2bottom () {
    var self = this
    setTimeout(function () {
      self._view.term.scrollTop = self._view.term.scrollHeight
    }, 0)
  }
  _blocksRenderer (mode) {
    mode = { log: styles.terminal.text_RegularLog, info: styles.terminal.text_InfoLog, error: styles.terminal.text_ErrorLog }[mode] // defaults
    if (mode) {
      return function logger (args, scopedCommands, append) {
        var types = args.map(type)
        var values = javascriptserialize.apply(null, args).map(function (val, idx) {
          if (typeof args[idx] === 'string') val = args[idx]
          if (types[idx] === 'element') val = jsbeautify.html(val)
          return val
        })
        append(yo`<span style="color: ${mode};">${values}</span>`)
      }
    } else {
      throw new Error('mode is not supported')
    }
  }
  _scopeCommands (append) {
    var self = this
    var scopedCommands = {}
    Object.keys(self.commands).forEach(function makeScopedCommand (cmd) {
      var command = self._commands[cmd]
      scopedCommands[cmd] = function _command () {
        var args = [...arguments]
        command(args, scopedCommands, el => append(cmd, args, blockify(el)))
      }
    })
    return scopedCommands
  }
  registerFilter (commandName, filterFn) {
    this.data.filterFns[commandName] = filterFn
  }
  registerCommand (name, command, opts) {
    var self = this
    name = String(name)
    if (self._commands[name]) throw new Error(`command "${name}" exists already`)
    if (typeof command !== 'function') throw new Error(`invalid command: ${command}`)
    self._commands[name] = command
    self._INDEX.commands[name] = []
    self._INDEX.commandsMain[name] = []
    self.commands[name] = function _command () {
      var args = [...arguments]
      var steps = []
      var root = { steps, cmd: name }
      var ITEM = { root, cmd: name }
      root.gidx = self._INDEX.allMain.push(ITEM) - 1
      root.idx = self._INDEX.commandsMain[name].push(ITEM) - 1
      function append (cmd, params, el) {
        var item
        if (cmd) { // subcommand
          item = { el, cmd, root }
        } else { // command
          item = ITEM
          item.el = el
          cmd = name
        }
        item.gidx = self._INDEX.all.push(item) - 1
        item.idx = self._INDEX.commands[cmd].push(item) - 1
        item.step = steps.push(item) - 1
        item.args = params
        self._appendItem(item)
      }
      var scopedCommands = self._scopeCommands(append)
      command(args, scopedCommands, el => append(null, args, blockify(el)))
    }
    var help = typeof command.help === 'string' ? command.help : [
      '// no help available for:',
      `terminal.commands.${name}(...)`
    ].join('\n')
    self.commands[name].toString = _ => { return help }
    self.commands[name].help = help
    self.data.activeFilters.commands[name] = opts && opts.activate
    if (opts.filterFn) {
      self.registerFilter(name, opts.filterFn)
    }
    return self.commands[name]
  }
  _shell (script, scopedCommands, done) { // default shell
    var self = this
    var context = domTerminalFeatures(self, scopedCommands)
    try {
      var cmds = vm.createContext(Object.assign(self._jsSandboxContext, context))
      var result = vm.runInContext(script, cmds)
      self._jsSandboxContext = Object.assign(cmds, context)
      done(null, result)
    } catch (error) {
      done(error.message)
    }
  }
}

function domTerminalFeatures (self, scopedCommands) {
  return {
    web3: executionContext.getProvider() !== 'vm' ? new Web3(executionContext.web3().currentProvider) : null,
    console: {
      log: function () { scopedCommands.log.apply(scopedCommands, arguments) },
      info: function () { scopedCommands.info.apply(scopedCommands, arguments) },
      error: function () { scopedCommands.error.apply(scopedCommands, arguments) }
    },
    setTimeout: (fn, time) => {
      return setTimeout(() => { self._shell('(' + fn.toString() + ')()', scopedCommands, () => {}) }, time)
    },
    setInterval: (fn, time) => {
      return setInterval(() => { self._shell('(' + fn.toString() + ')()', scopedCommands, () => {}) }, time)
    },
    clearTimeout: clearTimeout,
    clearInterval: clearInterval
  }
}

function blockify (el) { return yo`<div class=${css.block}>${el}</div>` }

module.exports = Terminal
