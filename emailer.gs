// global configuration
var Conf = {
  name_patt: /\D+\d+/,             // pattern of sheet/form name to check
  tmpl_name: {
    finished: "[email樣板]報名程序完成",      // document name of 'finihsed' email template, should be located in the same folder
    full: "[email樣板]額滿通知",              // document name of 'full' email template, should be located in the same folder
    reminder: "[email樣板] 繳費提醒",         // document name of 'reminder' email template, should be located in the same folder
    in_progress: "[email樣板]報名進行中"      // document name of 'in progress' email template, should be located in the same folder
  },
  tmpl_patt: /from:\s(.*)\ntitle:\s(.*)\nbody:\n((.|\n)*)/,   // pattern of email template
  price_patt: /(\$\d+)/,          // pattern of price
  customer_rec: [6, 1],           // top-left corner of customer records. [row, col]
  
  // info not to be resolved.
  info: {
    "MAX": [4, 2],
    "報名成功人數": [4, 4],
    "報名人數": [3, 1],
  },

  // info to be resolved.
  resolve: {
    "路線": [2, 3],
    "集合地點內容介紹": [2, 5],
    "日期": [2, 1],
    "開始時間": [2, 2],
    "伴走志工": [2, 4],
    "繳費期限": [2, 6],
    "繳費時間": [2, 7],
    "轉帳資訊": [3, 3],
  },

  log_sheet: "log",
  is_debug: false,               // won't send mail in debug mode
  is_log: true,                  // logging
};

// indexes in sheet
var Const = {
  sent: 0,              // index to sent flat
  status: 1,            // index to status
  paid_status: 2,       // index to paid status
  email: 5,             // index to email address
  price: 7,             // index to paid price
  last_5_digits: 8,     // index to the last 5 digits
  name: 10,             // index to customer's name
};

// indexes in e.values of form submit event.
var Const_Event = {
  email: 1,             // index to email address
  price: 3,             // index to paid price
  last_5_digits: 4,     // index to the last 5 digits
  name:  6,             // index to customer's name
};


function log_(msg) {
  if (Conf.is_debug == false && Conf.is_log == false) {
    return;
  }
  
  // create a 'Log' sheet
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(Conf.log_sheet);
  if (sheet == null) {
    sheet = SpreadsheetApp.getActiveSpreadsheet().insertSheet(Conf.log_sheet);
    if (sheet == null) {
      Logger.log("Unable to create log sheet");
      return;
    }
  }

  sheet.appendRow([msg]);
}


function resolve_(s, sheet, customer, customer_idx) {
  // this function resolve '[...]' in string.
  var ret = s;
  
  for (var key in Conf.resolve) {
    var patt = "(\\[" + key + "\\])";
    var range = sheet.getRange(Conf.resolve[key][0], Conf.resolve[key][1]);
    var val = range.getValue();
    
    // special case for Date object
    if (val instanceof Date) {
      var fmt = range.getNumberFormat();
      if (fmt) {
        // now 'Time' format would produce various unexpected result
        // use 'Plain Text' would make things easier.

        val = Utilities.formatDate(val, "GMT+0800", fmt);
      }
    }
    
    ret = ret.replace(new RegExp(patt, "g"), val);
  }
  
  // resolve 票價
  var patt = /\[票價\]/;
  ret = ret.replace(patt, customer[customer_idx.price]);
  
  var patt =  /\[姓名\]/;
  ret = ret.replace(patt, customer[customer_idx.name]);
  
  var patt =  /\[導覽單號\]/;
  ret = ret.replace(patt, sheet.getName());
  
  var patt = /\[帳號五碼]/
  ret = ret.replace(patt, customer[customer_idx.last_5_digits]);
  
  return ret;
}


function prepareEmail_(customer, customer_idx, sheet, tmpl) {
  var ret = {
    to: customer[customer_idx.email],
    title: resolve_(tmpl.title, sheet, customer, customer_idx),
    body: resolve_(tmpl.body, sheet, customer, customer_idx),
  };
  
  return ret;
}


function cb_full_(customer, sheet) {
  if (customer[Const.sent] == "V") return false;
  if (customer[Const.email] == "") return false;
  if (customer[Const.status] != "") return false;
  if (customer[Const.paid_status] != "") return false; 
  //if (customer[Const.paid_status] == "已付全額" || customer[Const.paid_status] == "已付部分") return false; 
  
  // it seems useless to check sheet for each customer...
  // but currently, it's more intuitive to keep code here.
  var the_max = sheet.getRange(Conf.info["MAX"][0], Conf.info["MAX"][1]).getValue();
  var the_total = sheet.getRange(Conf.info["報名成功人數"][0], Conf.info["報名成功人數"][1]).getValue();
  
  if (the_total != null && the_max != null) {
    return the_total >= the_max;
  } else {
    return false;
  }
}

function cb_finished_(customer, _) {
  // skip those customers already got a email
  if (customer[Const.sent] == "V") return false;
  if (customer[Const.email] == "") {
    return false;
  }
  if (customer[Const.status] != "已報名成功") {
    return false;
  }
  
  return true;
}

function cb_reminder_(customer, _) {
  // skip those customers already got a email
  if (customer[Const.status] != "") return false;
  if (customer[Const.sent] == "V") return false;
  if (customer[Const.email] == "") return false;
  
  return true;
}


function handleSheet_(name, tmpl, cb) {
  // make sure it's the sheet we need to process by checking pattern of name.
  if (null == name.match(Conf.name_patt)) {
    log_("[info] skip sheet: [" + name + "]");
    return;
  }

  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(name);
  if (sheet != null) {
    // get datum of all customers
    var customers = sheet.getRange(Conf.customer_rec[0], Conf.customer_rec[1], sheet.getLastRow(), sheet.getLastColumn()).getValues()

    // iterate through all customers
    for (var i = 0; i < customers.length; i++) {
      var curC = customers[i];
      
      if (false == cb(curC, sheet)) continue;

      // trim useless words in paid price of each customer
      var matched = curC[Const.price].match(Conf.price_patt);
/*      if (matched != null) {
        curC[Const.price] = matched[0];
      } else {
        log_("[error] unable to locate price in string: [" + curC[Const.price] + "]");
        
        // skip this customer.
        continue;
      }
*/
      // prepare email content by resolving those variables.
      var email = prepareEmail_(curC, Const, sheet, tmpl);

      try {
        if (Conf.is_debug == false) {
          MailApp.sendEmail(email.to, email.title, email.body);
          
          // update email sent status
          if (cb != cb_reminder_) sheet.getRange(i+Conf.customer_rec[0], 1).setValue("V");
        }
        
        log_("[info] mail sent: [" + email.to + "]");
      } catch (e) {
        log_("[error] unable to send email: [" + e.message + "]");
      }
    }
  } else {
    log_("[warning] unable to find sheet: [" + name + "]");
  }
}


function getEmailTemplate_(name) {
  var tmpl = DriveApp.getFilesByName(name);
  while (tmpl.hasNext()) {
    var f = tmpl.next();
    if (f.getMimeType() != "application/vnd.google-apps.document") continue;

    var doc = DocumentApp.openById(f.getId());
    var tmplText = doc.getBody().getText().match(Conf.tmpl_patt);
    return {
      from: tmplText[1],
      title: tmplText[2],
      body: tmplText[3]
    };
  }

  log_("Unable to load email template[" + name + "]");
  return null;
}


function getFormById_(id) {
  // here shows another way to get parent folder
  // not sure which way is correct, comparing to getEmailTemplate_
  var iter_folder = DriveApp.getFileById(SpreadsheetApp.getActive().getId()).getParents();
  var parent_folder = null
  if (iter_folder.hasNext()) {
    parent_folder = iter_folder.next();
  }
  if (!parent_folder) return null;

  var iter_file = parent_folder.getFilesByType("application/vnd.google-apps.form")
  while (iter_file.hasNext()) {
    var f = iter_file.next();
    if (-1 === f.getName().indexOf(id)) continue;

    return FormApp.openById(f.getId());
  }
  
  return null;
}


// entry point
function notify_finished(e) {
  log_("begin of notify_finished");
  
  // load email template
  var tmpl = getEmailTemplate_(Conf.tmpl_name.finished)
  if (tmpl != null) {
    // looping through each sheet
    var sheets = SpreadsheetApp.getActiveSpreadsheet().getSheets();
    for (var i = 0; i < sheets.length; i++) {
      handleSheet_(sheets[i].getName(), tmpl, cb_finished_);
    }
  }
  
  log_("end of notify_finished");
}


// entry point
function notify_full(e) {
  log_("begin of notify_full");
  
  // load email template
  var tmpl = getEmailTemplate_(Conf.tmpl_name.full);
  if (tmpl != null) {  
    // looping through each sheet
    var sheets = SpreadsheetApp.getActiveSpreadsheet().getSheets();
    for (var i = 0; i < sheets.length; i++) {
      handleSheet_(sheets[i].getName(), tmpl, cb_full_);
    }
  }
  
  log_("end of notify_full");
}

// entry point
function reminder(e) {
  log_("begin of reminder");
  
  // load email template
  var tmpl = getEmailTemplate_(Conf.tmpl_name.reminder);
  if (tmpl != null) {  
    // looping through each sheet
    var sheets = SpreadsheetApp.getActiveSpreadsheet().getSheets();
    for (var i = 0; i < sheets.length; i++) {
      handleSheet_(sheets[i].getName(), tmpl, cb_reminder_);
    }
  }
  
  log_("end of reminder");
}

// entry point of form close
function close_form(e) {
  log_("begin of close_form")
  var sheets = SpreadsheetApp.getActiveSpreadsheet().getSheets();
  for (var i = 0; i < sheets.length; i++) {
    // check if this sheet is for customer record (containing ID in name)
    var id = sheets[i].getName().match(Conf.name_patt);
    if (!!id) {
      id = id[0];
    } else {
      continue;
    }
    
    // check if we need to close the corresponding form
    var the_max = sheets[i].getRange(Conf.info["MAX"][0], Conf.info["MAX"][1]).getValue();
    var the_total = sheets[i].getRange(Conf.info["報名成功人數"][0], Conf.info["報名成功人數"][1]).getValue();
    
    if (the_total < the_max) continue;
    
    // find form
    var form = getFormById_(id);
    if (!form) {
      log_("can't find form for sheet:" + sheet[i].getName());
      continue;
    }

    log_("turn off form:" + form.getTitle());
    form.setAcceptingResponses(false);
  }
  log_("end of close_form")
}

// entry point of form submit
function form_submit(e) {
  log_("begin of form_submit");
  
  // load email template
  var tmpl = getEmailTemplate_(Conf.tmpl_name.in_progress);
  if (tmpl == null) {
    log_("unable to load email template:" + Conf.tmpl_name.in_progress);
    return;
  }
  
  var email = prepareEmail_(e.values, Const_Event, e.range.getSheet(), tmpl);
  try {
    if (Conf.is_debug == false) {
      MailApp.sendEmail(email.to, email.title, email.body);
    }
        
    log_("[info] mail sent: [" + email.to + "]");
  } catch (e) {
    log_("[error] unable to send email: [" + e.message + "]");
  }
  
  log_("end of form_submit");    
}
